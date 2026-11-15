import { createOutbound } from "outbound-sdk";
import { evaluateCheck, parseCheck } from "outbound-sdk/alerts";
import { insights } from "outbound-sdk/insights";
import { memory } from "outbound-sdk/memory";

import { seed } from "../plugins-index/seed.ts";

// Checks as they would be stored: plain JSON, in a file, a database row or a
// settings screen. parseCheck validates each one and throws on a bad one.
const stored = `[
  { "name": "bounce-spike", "metric": "bounce_rate", "op": ">", "value": 0.05 },
  { "name": "campaign-quiet", "metric": "sent", "op": "==", "value": 0,
    "scope": { "campaign": "memory:agency:cmp_ecom" }, "window": { "days": 7 } },
  { "name": "sender-down", "metric": "sender_status", "op": "!=", "value": "active" },
  { "name": "reply-waiting", "metric": "positive_reply_waiting_hours", "op": ">", "value": 48 }
]`;

const [bounce, quiet, senderDown, waiting] = JSON.parse(stored).map(parseCheck);

const outbound = createOutbound({
  adapter: memory({ data: seed, workspaceId: "agency" }),
  plugins: [insights()],
});

// Each check reads one thing. CHECK_METRICS[metric].reads says which.
const daily = await outbound.stats({
  by: "day",
  from: "2026-11-11",
  scope: "campaign",
  to: "2026-11-13",
});

const senders = await outbound.senders.list();
const dropped = await outbound.insights.droppedReplies({});

const results = [
  evaluateCheck(bounce, daily),
  evaluateCheck(quiet, daily),
  evaluateCheck(senderDown, senders),
  evaluateCheck(waiting, dropped),
];

for (const result of results) {
  console.log(`${result.check}: ${result.status} (${result.checked} checked)`);

  for (const breach of result.breaches) {
    console.log(`  ${breach.subjectName ?? breach.subject}: ${breach.message}`);
    console.log(
      `  ${JSON.stringify(breach.numbers)}${breach.day ? ` on ${breach.day}` : ""}`
    );
  }
}
