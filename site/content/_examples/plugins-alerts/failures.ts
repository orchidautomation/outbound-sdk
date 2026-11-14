import { createOutbound } from "outbound-sdk";
import { alerts, bounceRateAbove, senderNotActive } from "outbound-sdk/alerts";
import type { Alert } from "outbound-sdk/alerts";
import { memory } from "outbound-sdk/memory";

import { seed } from "../plugins-index/seed.ts";

// 1. A notifier that fails cannot fail the read. The failure is dropped.
const outbound = createOutbound({
  adapter: memory({ data: seed, workspaceId: "agency" }),
  plugins: [
    alerts({
      notify: () => Promise.reject(new Error("Slack is down")),
      rules: [senderNotActive()],
    }),
  ],
});

const senders = await outbound.senders.list();

console.log("read succeeded:", senders.items.length, "senders");

// 2. A rate on a handful of sends is noise, so small rows are skipped.
//    One day of the ecommerce campaign is 100 sends and 9 bounces.
const notified: Alert[] = [];

const strict = createOutbound({
  adapter: memory({ data: seed, workspaceId: "agency" }),
  plugins: [
    alerts({
      notify: (found) => {
        notified.push(...found);
      },
      rules: [bounceRateAbove(0.05, { minSent: 150 })],
    }),
  ],
});

const day = await strict.campaign("cmp_ecom").stats({
  from: "2026-11-13",
  to: "2026-11-13",
});

console.log(
  "sent",
  day.rows[0]?.sent,
  "-> alerts:",
  strict.alerts.evaluate(day.rows).length
);

const both = await strict.campaign("cmp_ecom").stats({
  from: "2026-11-12",
  to: "2026-11-13",
});

console.log(
  "sent",
  both.rows[0]?.sent,
  "-> alerts:",
  strict.alerts.evaluate(both.rows).length
);
