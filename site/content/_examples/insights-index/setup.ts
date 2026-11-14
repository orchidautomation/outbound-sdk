import { createOutbound } from "outbound-sdk";
import { combine } from "outbound-sdk/combine";
import { heyreach } from "outbound-sdk/heyreach";
import { insights } from "outbound-sdk/insights";
import { instantly } from "outbound-sdk/instantly";

// Reads INSTANTLY_API_KEY and HEYREACH_API_KEY. One adapter works the same.
export const outbound = createOutbound({
  adapter: combine([instantly(), heyreach()]),
  // The most vendor requests one call may make before it fails.
  maxRequests: 200,
  plugins: [insights()],
});

// Every insight is now a typed method: outbound.insights.personSummary,
// outbound.insights.clientReport and 24 more.
