import { OutboundError } from "outbound-sdk";
import type { OutboundPlugin } from "outbound-sdk";

// The in-memory adapter never fails, so this stand-in fails for it. While
// `down` is set, every read ends the way a vendor outage does: a `Provider`
// error, after the SDK's own retries would have run out.
export const vendor = { down: false };

export const outage: OutboundPlugin = {
  name: "outage",
  wrap: async (operation, next, info) => {
    if (vendor.down) {
      throw new OutboundError("Provider", "The vendor answered 503", {
        provider: info.provider,
        status: 503,
      });
    }

    return await next(operation);
  },
};
