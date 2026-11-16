import { outbound } from "./outbound.ts";

const { data } = await outbound.insights.stepFunnel({
  campaign: "memory:acme:founders",
  min_reply_rate: 0.01,
});

console.log(data.finding);

for (const step of data.steps) {
  console.log(
    `step ${step.step}: sent ${step.sent}, replies ${step.replies}, rate ${step.rates.replyRate.rate} (${step.rates.replyRate.low} to ${step.rates.replyRate.high}), share ${step.shareOfReplies}, drop ${step.sentDropRate}, earns place ${step.earnsPlace}`
  );
}

console.log(
  "step 0 variants:",
  data.steps[0]?.variants.map(
    (each) => `${each.variantKey} ${each.rates.replyRate.rate}`
  )
);
