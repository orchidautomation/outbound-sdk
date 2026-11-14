// outbound-sdk/audit: records every call, its duration and its rate cost, for
// debugging. Entries hold no record data, no query values and no secrets:
// only what was asked, how long it took and what it cost.

import { OutboundError } from "../internal/errors.ts";
import type { RequestEvent } from "../internal/hooks.ts";
import type { OutboundPlugin } from "../internal/outbound/plugins.ts";

export interface AuditCall {
  readonly type: "call";
  /** ISO 8601 UTC. */
  readonly at: string;
  readonly operation: string;
  readonly provider: string;
  readonly workspaceId: string;
  readonly durationMs: number;
  /** Vendor requests this operation made. */
  readonly requests: number;
  readonly throttledMs: number;
  /** Records returned. `null` when the call failed. */
  readonly records: number | null;
  /** The error code when the call failed. */
  readonly error: string | null;
}

export interface AuditRequest extends RequestEvent {
  readonly type: "request";
  readonly at: string;
}

export type AuditEntry = AuditCall | AuditRequest;

export interface AuditOptions {
  /** Receives every entry. A sink that throws or rejects is ignored. */
  readonly sink: (entry: AuditEntry) => void | Promise<void>;
  /** Also record each HTTP request, with its redacted URL. Defaults to `false`. */
  readonly requests?: boolean | undefined;
  /** The clock, for tests. */
  readonly now?: (() => number) | undefined;
}

const ignore = (): void => {
  // An audit sink must never fail the call it records.
};

/** Records every call and its rate cost. */
export const audit = (options: AuditOptions): OutboundPlugin => {
  const now = options.now ?? (() => Date.now());

  const record = (entry: AuditEntry): void => {
    try {
      // oxlint-disable-next-line promise/prefer-await-to-then -- fire-and-forget by design.
      Promise.resolve(options.sink(entry)).catch(ignore);
    } catch {
      ignore();
    }
  };

  return {
    hooks: options.requests
      ? {
          onRequest: (event) => {
            record({
              ...event,
              at: new Date(now()).toISOString(),
              type: "request",
            });
          },
        }
      : undefined,
    name: "audit",
    wrap: async (operation, next, info) => {
      const startedAt = now();

      const before = {
        requests: info.state.requests,
        throttledMs: info.state.throttledMs,
      };

      const entry = (
        records: number | null,
        error: string | null
      ): AuditCall => ({
        at: new Date(startedAt).toISOString(),
        durationMs: now() - startedAt,
        error,
        operation: operation.kind,
        provider: info.provider,
        records,
        requests: info.state.requests - before.requests,
        throttledMs: info.state.throttledMs - before.throttledMs,
        type: "call",
        workspaceId: info.workspaceId,
      });

      try {
        const output = await next(operation);
        record(entry(output.items.length, null));

        return output;
      } catch (error) {
        record(entry(null, OutboundError.is(error) ? error.code : "Provider"));
        throw error;
      }
    },
  };
};
