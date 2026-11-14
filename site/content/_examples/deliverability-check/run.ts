import { createOutbound } from "outbound-sdk";
import { alerts, bounceRateAbove, senderNotActive } from "outbound-sdk/alerts";
import type { Alert } from "outbound-sdk/alerts";
import { insights } from "outbound-sdk/insights";
import { memory } from "outbound-sdk/memory";

import { deliverabilityCheck } from "./check.ts";
import { seed } from "./seed.ts";

// Your notifier. Here it collects; in production it posts to Slack, email
// or a pager. It is called once per read that broke a rule.
const received: Alert[] = [];

const notify = (fired: readonly Alert[]): void => {
  received.push(...fired);
};

const outbound = createOutbound({
  adapter: memory({ data: seed, workspaceId: "acme" }),
  plugins: [
    insights(),
    alerts({
      notify,
      rules: [bounceRateAbove(0.03, { minSent: 100 }), senderNotActive()],
    }),
  ],
});

console.log(await deliverabilityCheck(outbound));

console.log("\nAlerts the notifier received:");

for (const alert of received) {
  console.log(`  ${alert.rule} ${alert.subject}: ${alert.message}`);
}
