import { createOutbound, OutboundError } from "outbound-sdk";
import { insights } from "outbound-sdk/insights";
import { memory } from "outbound-sdk/memory";

import { CAMPAIGN, seed, unsplitSeed } from "./seed.ts";
import { abVerdict } from "./verdict.ts";

// 1. A vendor whose step stats are not split by variant: the answer is an
//    empty list and a note, not a verdict.
const unsplit = createOutbound({
  adapter: memory({ data: unsplitSeed, workspaceId: "acme" }),
  plugins: [insights()],
});

const none = await unsplit.insights.variantTest({ campaign: CAMPAIGN });

console.log(
  "no variant rows:",
  none.data.variantStatsReported,
  none.data.steps.length,
  none.meta.notes
);

const outbound = createOutbound({
  adapter: memory({ data: seed, workspaceId: "acme" }),
  plugins: [insights()],
});

// 2. A metric the vendor does not report for the variants. Opens are not in
//    this data, so no step can be judged on them.
const opens = await outbound.insights.variantTest({
  campaign: CAMPAIGN,
  metric: "opened",
});

console.log("unreported metric:", opens.data.steps[0]?.reason);

// 3. An input the insight does not take is refused, never dropped.
try {
  // @ts-expect-error -- `step` is not an input of variantTest
  await outbound.insights.variantTest({ campaign: CAMPAIGN, step: 0 });
} catch (error) {
  if (OutboundError.is(error)) {
    console.log("unknown input:", error.code, "-", error.message);
  }
}

// 4. An alpha outside its range is refused before any request.
try {
  await outbound.insights.variantTest({ alpha: 0.9, campaign: CAMPAIGN });
} catch (error) {
  if (OutboundError.is(error)) {
    console.log("bad input:", error.code, "-", error.message);
  }
}

// 5. A campaign that does not exist. The first read of it says so.
try {
  await abVerdict(outbound, "cmp_missing");
} catch (error) {
  if (OutboundError.is(error)) {
    console.log("unknown campaign:", error.code, "-", error.message);
  }
}
