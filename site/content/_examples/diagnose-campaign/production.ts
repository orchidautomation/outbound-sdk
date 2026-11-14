import { createOutbound } from "outbound-sdk";
import { benchmarks } from "outbound-sdk/benchmarks";
import { insights } from "outbound-sdk/insights";
import { instantly } from "outbound-sdk/instantly";

// Reads INSTANTLY_API_KEY. Swap the import for smartlead() or heyreach().
export const outbound = createOutbound({
  adapter: instantly({ workspaceId: "acme" }),
  // One diagnosis with its context may spend at most 30 vendor requests.
  maxRequests: 30,
  plugins: [insights(), benchmarks()],
});
