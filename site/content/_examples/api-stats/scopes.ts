import { createOutbound } from "outbound-sdk";
import { memory } from "outbound-sdk/memory";

import { seed } from "./seed.ts";

const outbound = createOutbound({ adapter: memory({ data: seed }) });

// The whole workspace, one total row.
const workspace = await outbound.stats();

console.log("workspace:", workspace.rows[0]?.sent, "sent");

// One campaign, one row per day.
const daily = await outbound.campaign("cmp_launch").stats({
  by: "day",
  from: "2026-11-09",
  to: "2026-11-10",
});

for (const row of daily.rows) {
  console.log(row.date, row.sent, "sent,", row.replied, "replied");
}

// One row per step of the campaign.
const steps = await outbound.campaign("cmp_launch").stats({ scope: "step" });

for (const row of steps.rows) {
  console.log("step", row.stepIndex, row.sent, "sent,", row.replied, "replied");
}

// One mailbox.
const sender = await outbound.sender("mbx_ben").stats();

console.log(
  "mbx_ben:",
  sender.rows[0]?.sent,
  "sent,",
  sender.rows[0]?.bounced,
  "bounced"
);

// The same reads through the top-level method.
const same = await outbound.stats({ scope: "sender", scopeId: "mbx_ben" });

console.log(same.rows[0]?.scope, same.rows[0]?.scopeRef, same.meta.evidence);
