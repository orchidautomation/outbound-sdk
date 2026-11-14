import { createOutbound } from "outbound-sdk";
import { insights } from "outbound-sdk/insights";
import { instantly } from "outbound-sdk/instantly";

// Reads INSTANTLY_API_KEY.
export const outbound = createOutbound({
  adapter: instantly({ workspaceId: "acme" }),
  // One list may spend at most 30 vendor requests.
  maxRequests: 30,
  plugins: [insights()],
});
