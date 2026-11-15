import { createOutbound } from "outbound-sdk";
import { insights } from "outbound-sdk/insights";
import { smartlead } from "outbound-sdk/smartlead";

// Reads SMARTLEAD_API_KEY. Swap the import for instantly(). HeyReach can
// serve the copy and merge-variable audits, not the settings audit.
export const outbound = createOutbound({
  adapter: smartlead({ workspaceId: "acme" }),
  // One audit may spend at most 80 vendor requests.
  maxRequestsPerCall: 80,
  plugins: [insights()],
});
