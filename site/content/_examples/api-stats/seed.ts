import type { MemoryData } from "outbound-sdk/memory";

// One campaign with two steps and two mailboxes, over two days. A row with
// `stepIndex` is a per-step row, a row with `senderId` is a per-sender row,
// and a row with neither is the campaign's own daily row.
export const seed: MemoryData = {
  campaigns: [{ id: "cmp_launch", name: "Launch week" }],
  senders: [
    { address: "ana@example.com", id: "mbx_ana" },
    { address: "ben@example.com", id: "mbx_ben" },
  ],
  stats: [
    {
      campaignId: "cmp_launch",
      counts: {
        bounced: 4,
        contacted: 180,
        delivered: 196,
        opened: 98,
        positive: 3,
        replied: 9,
        sent: 200,
        unsubscribed: 1,
      },
      date: "2026-11-09",
    },
    {
      campaignId: "cmp_launch",
      counts: {
        bounced: 2,
        contacted: 120,
        delivered: 148,
        opened: 60,
        positive: 3,
        replied: 6,
        sent: 150,
        unsubscribed: 0,
      },
      date: "2026-11-10",
    },
    {
      campaignId: "cmp_launch",
      counts: { replied: 11, sent: 300 },
      date: "2026-11-10",
      stepIndex: 0,
    },
    {
      campaignId: "cmp_launch",
      counts: { replied: 4, sent: 50 },
      date: "2026-11-10",
      stepIndex: 1,
    },
    {
      campaignId: "cmp_launch",
      counts: { bounced: 1, sent: 210 },
      date: "2026-11-10",
      senderId: "mbx_ana",
    },
    {
      campaignId: "cmp_launch",
      counts: { bounced: 5, sent: 140 },
      date: "2026-11-10",
      senderId: "mbx_ben",
    },
  ],
};
