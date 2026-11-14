import { alertCard } from "outbound-sdk/cards";

// One alert, as the alerts plugin hands it to `notify`.
const card = alertCard({
  message: "Founders Q4 bounces at 8.1%, above the 3% limit.",
  rule: "bounce_rate_above",
  subject: "memory:acme:cmp_founders",
  threshold: 0.03,
  value: 0.081,
});

console.log(JSON.stringify(card, null, 2));
