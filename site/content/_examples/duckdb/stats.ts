// Daily campaign stats, which sync does not copy: read each campaign's days
// with `by: "day"` and replace the same campaign and day, so a day read again
// after the vendor revised it takes the new count.
import { createOutbound } from "outbound-sdk";
import { memory } from "outbound-sdk/memory";

import { seed } from "./seed.ts";
import { openWarehouse, show, upsertDailyStats } from "./warehouse.ts";

const outbound = createOutbound({
  adapter: memory({ data: seed, workspaceId: "acme" }),
});

const db = await openWarehouse();

for await (const campaign of outbound.campaigns.listAll()) {
  const { rows } = await outbound.campaign(campaign.ref).stats({
    by: "day",
    from: "2026-11-10",
    to: "2026-11-12",
  });

  await upsertDailyStats(db, rows);
}

console.log("reply rate per campaign:");

await show(
  db,
  `SELECT campaign_ref AS campaign,
          sum(sent)::INTEGER AS sent,
          sum(replied)::INTEGER AS replied,
          round(sum(replied) / sum(sent), 4) AS reply_rate
     FROM daily_stats GROUP BY ALL ORDER BY campaign`
);
