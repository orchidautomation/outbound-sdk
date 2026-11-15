// outbound-sdk/failover: serves the last good answer when a vendor is down.
//
// Every successful read is kept in a store you supply. When a later read
// fails because the vendor is unavailable or rate limited, the stored answer
// is returned with `meta.stale: true` and its original `meta.fetchedAt`. A
// failure that is the caller's own (a bad request, a missing record, a
// rejected key, a request cap) is never papered over.

import { cacheKey } from "../cache/index.ts";
import type { CacheStore } from "../cache/index.ts";
import { OutboundError } from "../internal/errors.ts";
import type { OutboundPlugin } from "../internal/outbound/plugins.ts";

export interface FailoverOptions {
  readonly store: CacheStore;
  /** How long a stored answer may be served, in seconds. Defaults to 7 days. */
  readonly maxAge?: number | undefined;
  /** The clock, for tests. */
  readonly now?: (() => number) | undefined;
}

const WEEK_SECONDS = 7 * 24 * 60 * 60;

// A `RateLimited` the vendor sent has `limit: "vendor"`. The ones the SDK
// raises itself do not: `maxRequests` and the budget plugin ("call", "run"),
// and a deadline that would pass while the local rate budget is full
// ("deadline"). Those are the caller's own caps, not an outage.
const vendorIsDown = (cause: unknown): boolean =>
  OutboundError.is(cause) &&
  !cause.aborted &&
  (cause.code === "Provider" ||
    (cause.code === "RateLimited" && cause.limit === "vendor"));

/** When the vendor was asked: an answer a layer inside served from a store says so itself. */
const fetchedAtOf = (fetchedAt: string | undefined, now: number): number =>
  fetchedAt === undefined ? now : Date.parse(fetchedAt);

/** Serves the last good answer, marked stale, when the vendor is down. */
export const failover = (options: FailoverOptions): OutboundPlugin => {
  const now = options.now ?? (() => Date.now());
  const maxAgeMs = (options.maxAge ?? WEEK_SECONDS) * 1000;

  return {
    name: "failover",
    wrap: async (operation, next, info) => {
      const key = `failover:${cacheKey(info, operation)}`;

      try {
        const output = await next(operation);

        await options.store.set(
          key,
          { output, storedAt: fetchedAtOf(output.fetchedAt, now()) },
          maxAgeMs
        );

        return output;
      } catch (error) {
        const saved = vendorIsDown(error)
          ? await options.store.get(key)
          : undefined;

        if (saved === undefined || now() - saved.storedAt > maxAgeMs) {
          throw error;
        }

        return {
          ...saved.output,
          fetchedAt: new Date(saved.storedAt).toISOString(),
          stale: true,
        };
      }
    },
  };
};
