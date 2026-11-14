import { computeRates, createOutbound, METRIC_DEFINITIONS } from "outbound-sdk";
import { memory } from "outbound-sdk/memory";

import { seed } from "./seed.ts";

const outbound = createOutbound({ adapter: memory({ data: seed }) });

const { rows } = await outbound.campaign("cmp_launch").stats({
  from: "2026-11-09",
  to: "2026-11-10",
});

const [total] = rows;

if (total !== undefined) {
  console.log(total.sent, "sent,", total.contacted, "contacted\n");

  const rates = computeRates(total);

  for (const [name, rate] of Object.entries(rates)) {
    const percent =
      rate.value === null ? "null" : `${(rate.value * 100).toFixed(1)}%`;

    console.log(`${name}: ${percent} of ${rate.basis}`);
  }
}

console.log(`\n${METRIC_DEFINITIONS.replyRate.name}:`);

console.log(METRIC_DEFINITIONS.replyRate.description);
