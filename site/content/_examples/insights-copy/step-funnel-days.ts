import { outbound } from "./outbound.ts";

// by_day needs an adapter that declares stats.byStepDay, such as the memory
// adapter or your own adapter over stored history. Every vendor adapter
// refuses it as Unsupported before any request.
const { data } = await outbound.insights.stepFunnel({
  by_day: true,
  campaign: "memory:acme:founders",
});

for (const day of data.days ?? []) {
  console.log(
    day.date,
    day.steps
      .map(
        (step) =>
          `step ${step.stepNumber}: sent ${step.sent}, replies ${step.replies}`
      )
      .join("; ")
  );
}
