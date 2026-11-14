import { OutboundError } from "outbound-sdk";
import type { OutboundErrorCode, OutboundPlugin } from "outbound-sdk";

/**
 * Fails the first `times` operations the way a vendor would, then lets the
 * rest through. The in-memory adapter has no failure switch of its own.
 */
export const failing = (
  code: OutboundErrorCode,
  times = 1,
  retryAfterMs?: number
): OutboundPlugin => {
  let left = times;

  return {
    name: "failing",
    wrap: (operation, next, info) => {
      if (left > 0) {
        left -= 1;

        throw new OutboundError(code, `injected ${code}`, {
          provider: info.provider,
          retryAfterMs,
        });
      }

      return next(operation);
    },
  };
};
