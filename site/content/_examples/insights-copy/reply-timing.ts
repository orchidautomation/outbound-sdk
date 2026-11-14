import { outbound } from "./outbound.ts";

const { data } = await outbound.insights.replyTiming({});

console.log("time to reply:", data.timeToReply);

console.log(
  `replies arrive most on ${data.replies.topWeekday} and at hour ${data.replies.topHour}`
);

console.log(
  `sends that drew a reply went out most on ${data.sendsThatDrewReplies.topWeekday} at hour ${data.sendsThatDrewReplies.topHour}`
);

console.log("counts:", data.counts);
