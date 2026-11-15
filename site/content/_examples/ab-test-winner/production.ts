import { createOutbound } from "outbound-sdk";
import { insights } from "outbound-sdk/insights";
import { instantly } from "outbound-sdk/instantly";

// Reads INSTANTLY_API_KEY. Swap the import for smartlead(). HeyReach cannot
// serve this guide: it has no stats per step.
export const outbound = createOutbound({
  adapter: instantly({ workspaceId: "acme" }),
  // The two insights spend 3 reads between them.
  maxRequestsPerCall: 10,
  plugins: [insights()],
});
