import { createOutbound } from "outbound-sdk";
import { combine } from "outbound-sdk/combine";
import { heyreach } from "outbound-sdk/heyreach";
import { insights } from "outbound-sdk/insights";
import { instantly } from "outbound-sdk/instantly";

// Reads INSTANTLY_API_KEY and HEYREACH_API_KEY. One tool works too: pass
// its adapter alone and every collision is `within_tool`.
export const outbound = createOutbound({
  adapter: combine([
    instantly({ workspaceId: "agency" }),
    heyreach({ workspaceId: "agency" }),
  ]),
  // One call may spend at most 300 vendor requests.
  maxRequests: 300,
  plugins: [insights()],
});
