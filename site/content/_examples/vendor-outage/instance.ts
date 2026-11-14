import { createOutbound } from "outbound-sdk";
import type { Adapter } from "outbound-sdk";
import { budget } from "outbound-sdk/budget";
import { cache, memoryCacheStore } from "outbound-sdk/cache";
import { failover } from "outbound-sdk/failover";
import { memory } from "outbound-sdk/memory";

import { outage } from "./outage.ts";
import { seed } from "./seed.ts";

const MINUTE = 60_000;

export interface Options {
  readonly adapter?: Adapter;
  /** Vendor requests the instance may make before `requestBudget.reset()`. */
  readonly maxRequests?: number;
  /** How long failover may serve an answer, in seconds. */
  readonly maxAge?: number;
}

export const build = (options: Options = {}) => {
  // The samples move this clock by hand. Leave `now` out in real code.
  let now = Date.parse("2026-11-14T12:00:00.000Z");
  const vendor = outage();

  const outbound = createOutbound({
    adapter: options.adapter ?? memory({ data: seed, workspaceId: "acme" }),
    plugins: [
      // Outermost: sees every failure from the layers inside it.
      failover({
        maxAge: options.maxAge,
        now: () => now,
        store: memoryCacheStore(),
      }),
      // A repeat read within a minute never reaches the vendor.
      cache({ now: () => now, ttl: 60 }),
      // Stops the instance from spending the vendor's whole rate limit.
      budget({ maxRequests: options.maxRequests ?? 100, per: "run" }),
      vendor.plugin,
    ],
    runtime: { now: () => now },
  });

  return {
    outbound,
    /** Moves the clock forward. */
    pass: (minutes: number) => {
      now += minutes * MINUTE;
    },
    vendor,
  };
};
