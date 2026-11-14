import { computeRates, createOutbound } from "outbound-sdk";
import { memory } from "outbound-sdk/memory";

// One day of results. The vendor reported sends, replies and bounces, and
// said nothing about opens.
const outbound = createOutbound({
  adapter: memory({
    data: {
      campaigns: [{ id: "cmp_1" }],
      senders: [{ id: "mbx_1" }],
      stats: [
        {
          campaignId: "cmp_1",
          counts: { bounced: 0, replied: 6, sent: 200 },
          date: "2026-11-10",
        },
      ],
    },
  }),
});

const { rows } = await outbound.campaign("cmp_1").stats();
const [row] = rows;

if (row !== undefined) {
  // 0 was reported. null was not reported.
  console.log("bounced:", row.bounced, "| opened:", row.opened);

  const rates = computeRates(row);

  console.log("bounce rate:", rates.bounceRate);
  console.log("open rate:", rates.openRate);
  console.log("reply rate:", rates.replyRate);
}

// Fields work the same way.
const sender = await outbound.sender("mbx_1").get();

console.log(sender.address, sender.dailyLimit, sender.warmup);
