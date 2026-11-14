import { createOutbound, OutboundError } from "outbound-sdk";
import { benchmarks } from "outbound-sdk/benchmarks";
import { memory } from "outbound-sdk/memory";

import { seed } from "../plugins-index/seed.ts";

const outbound = createOutbound({
  adapter: memory({ data: seed, workspaceId: "agency" }),
  plugins: [benchmarks()],
});

const percent = (rate: number | null): string =>
  rate === null ? "not reported" : `${(rate * 100).toFixed(1)}%`;

const range = { from: "2026-11-12", to: "2026-11-13" };

const results = await Promise.all(
  ["cmp_founders", "cmp_ecom"].map((id) =>
    outbound.benchmarks.campaign(id, range)
  )
);

for (const { campaign, comparisons } of results) {
  const { bounceRate, openRate, replyRate } = comparisons;

  console.log(campaign);
  console.log(
    `  reply rate ${percent(replyRate.value)}, workspace ${percent(replyRate.baseline)}, ratio ${replyRate.ratio?.toFixed(2)}`
  );
  console.log(
    `  bounce rate ${percent(bounceRate.value)}, workspace ${percent(bounceRate.baseline)}, ratio ${bounceRate.ratio?.toFixed(2)}`
  );
  // The seed has no opens, so there is no open rate and no ratio.
  console.log(
    `  open rate ${percent(openRate.value)}, ratio ${openRate.ratio}`
  );
}

// A campaign that does not exist.
try {
  await outbound.benchmarks.campaign("cmp_missing", range);
} catch (error) {
  if (OutboundError.is(error)) {
    console.log(`${error.code}: ${error.message}`);
  }
}

// An adapter with no workspace-wide stats cannot give the baseline.
const noWorkspace = createOutbound({
  adapter: memory({ capabilities: { "stats.workspace": false }, data: seed }),
  plugins: [benchmarks()],
});

try {
  await noWorkspace.benchmarks.campaign("cmp_founders", range);
} catch (error) {
  if (OutboundError.is(error)) {
    console.log(`${error.code}: ${error.message}`);
  }
}
