// A stand-in for the vendor's API. The in-memory adapter never fails and
// makes no HTTP request, so this plugin, listed last (innermost), fails the
// way a real adapter would and counts one request per operation.
import { OutboundError } from "outbound-sdk";
import type { OutboundErrorCode, OutboundPlugin } from "outbound-sdk";

const STATUS: Partial<Record<OutboundErrorCode, number>> = {
  NotFound: 404,
  Provider: 503,
  RateLimited: 429,
  Unauthorized: 401,
};

export interface Outage {
  readonly plugin: OutboundPlugin;
  /** Every operation fails with this code until `recover()`. */
  readonly fail: (code: OutboundErrorCode) => void;
  readonly recover: () => void;
}

export const outage = (): Outage => {
  let failing: OutboundErrorCode | undefined;

  return {
    fail: (code) => {
      failing = code;
    },
    plugin: {
      name: "outage",
      wrap: (operation, next, info) => {
        info.state.requests += 1;

        if (failing !== undefined) {
          const status = STATUS[failing];

          throw new OutboundError(
            failing,
            `${info.provider} responded ${status}`,
            { provider: info.provider, status }
          );
        }

        return next(operation);
      },
    },
    recover: () => {
      failing = undefined;
    },
  };
};
