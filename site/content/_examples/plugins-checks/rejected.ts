import { describeIssues, validateCheck } from "outbound-sdk/alerts";

// Checks written the way people (and models) often first write them. Every
// problem comes back at once, each with what to write instead.
const drafts = [
  { metric: "bounceRate", op: "gt", threshold: 5 },
  {
    metric: "bounce_rate",
    op: ">",
    value: 5,
    scope: { campaign: "Ecommerce ops" },
  },
  { metric: "lead_runway_days", op: "<", value: 7, window: { days: 7 } },
  { metric: "sender_status", op: ">", value: "down" },
];

for (const draft of drafts) {
  const validation = validateCheck(draft);

  console.log(JSON.stringify(draft));
  console.log(validation.ok ? "ok" : describeIssues(validation.issues));
  console.log();
}
