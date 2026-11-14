import { createOutbound } from "outbound-sdk";
import {
  alerts,
  bounceRateAbove,
  noSends,
  replyRateBelow,
  senderNotActive,
} from "outbound-sdk/alerts";
import type { Alert, AlertRule } from "outbound-sdk/alerts";
import { memory } from "outbound-sdk/memory";

import { seed } from "../plugins-index/seed.ts";

// A rule of your own: any function from a record to an alert or null.
// This one fires for a campaign that carries no tag.
const untaggedCampaign: AlertRule = {
  check: (record) =>
    "channel" in record && "tags" in record && record.tags.length === 0
      ? {
          message: `${record.name} has no tag, so no client rule can match it`,
          rule: "untagged-campaign",
          subject: record.ref,
          threshold: 1,
          value: 0,
        }
      : null,
  name: "untagged-campaign",
};

const fired: Alert[] = [];

const outbound = createOutbound({
  adapter: memory({ data: seed, workspaceId: "agency" }),
  plugins: [
    alerts({
      // Post to Slack, page someone, write a row. Here: keep them.
      notify: (found) => {
        fired.push(...found);
      },
      rules: [
        bounceRateAbove(0.05),
        replyRateBelow(0.02),
        senderNotActive(),
        noSends(),
        untaggedCampaign,
      ],
    }),
  ],
});

// Rules run on whatever these reads return. Nothing else is fetched.
for await (const campaign of outbound.campaigns.listAll()) {
  await outbound.campaign(campaign.ref).stats({
    from: "2026-11-12",
    to: "2026-11-13",
  });
}

await outbound.senders.list();

await outbound.campaign("cmp_ecom").stats({
  by: "day",
  from: "2026-11-11",
  to: "2026-11-13",
});

for (const alert of fired) {
  console.log(`[${alert.rule}] ${alert.subject}: ${alert.message}`);
}

// evaluate() checks records you already hold, and does not call notify.
const page = await outbound.senders.list();
const notified = fired.length;
const found = outbound.alerts.evaluate(page.items);

console.log(
  "\nevaluate:",
  found.map((alert) => alert.rule)
);

console.log("notify called by evaluate:", fired.length > notified);
