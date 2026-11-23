import { createOutbound } from "outbound-sdk";
import { insights } from "outbound-sdk/insights";
import { memory } from "outbound-sdk/memory";

import { seed } from "./seed.ts";

// An adapter with daily stats per campaign but no workspace stats, as an
// adapter over stored history may be.
const outbound = createOutbound({
  adapter: memory({
    capabilities: { "stats.workspace": false },
    data: seed,
    workspaceId: "acme",
  }),
  plugins: [insights()],
});

const { data, meta } = await outbound.insights.anomalies({});

console.log(`${data.scope}, evidence ${meta.evidence}`);

console.log(meta.notes.join("\n"));

for (const anomaly of data.anomalies) {
  console.log(`${anomaly.direction}: ${anomaly.finding}`);
}
