import { createOutbound, fillDays } from "outbound-sdk";
import { memory } from "outbound-sdk/memory";

const outbound = createOutbound({
  adapter: memory({
    data: {
      campaigns: [{ id: "cmp_launch", name: "Launch" }],
      stats: [
        {
          campaignId: "cmp_launch",
          counts: { replied: 3, sent: 120 },
          date: "2026-11-09",
        },
        {
          campaignId: "cmp_launch",
          counts: { replied: 1, sent: 80 },
          date: "2026-11-11",
        },
      ],
    },
  }),
});

const { rows } = await outbound.campaign("cmp_launch").stats({
  by: "day",
  from: "2026-11-09",
  to: "2026-11-11",
});

const show = (label: string, days: typeof rows): void => {
  console.log(label);

  for (const day of days) {
    console.log(
      `  ${day.date} sent ${day.sent} replied ${day.replied} opened ${day.opened} (${day.evidence})`
    );
  }
};

show("as the vendor sent them:", rows);

show(
  "every day, unknown when missing:",
  fillDays(rows, { from: "2026-11-09", to: "2026-11-11" })
);

show(
  "every day, 0 when missing:",
  fillDays(rows, { fill: "zero", from: "2026-11-09", to: "2026-11-11" })
);
