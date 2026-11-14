import { createOutbound } from "outbound-sdk";
import { alerts, bounceRateAbove, senderNotActive } from "outbound-sdk/alerts";
import type { Alert } from "outbound-sdk/alerts";
import { insights } from "outbound-sdk/insights";
import { instantly } from "outbound-sdk/instantly";

// Replace with a post to Slack, email or a pager. A notifier that throws or
// rejects cannot fail the read it reports on, so log its own failures here.
const notify = (fired: readonly Alert[]): void => {
  for (const alert of fired) {
    console.error(`[${alert.rule}] ${alert.subject}: ${alert.message}`);
  }
};

// Reads INSTANTLY_API_KEY. Swap the import for smartlead() or heyreach().
export const outbound = createOutbound({
  adapter: instantly({ workspaceId: "acme" }),
  // One check may spend at most 300 vendor requests.
  maxRequests: 300,
  plugins: [
    insights(),
    alerts({
      notify,
      rules: [bounceRateAbove(0.03, { minSent: 100 }), senderNotActive()],
    }),
  ],
});
