import { outbound } from "./outbound.ts";

const { data } = await outbound.insights.droppedReplies({});

for (const reply of data.dropped) {
  console.log(
    `${reply.lead}: ${reply.finding} Unanswered replies: ${reply.unansweredReplies}. Checked by ${reply.checkedBy}.`
  );
}

console.log("since:", data.since);

console.log("totals:", data.totals);
