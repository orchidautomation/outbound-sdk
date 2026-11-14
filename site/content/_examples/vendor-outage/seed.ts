// One client with two campaigns and a week of results for each.
import type { MemoryData } from "outbound-sdk/memory";

const DAYS = [7, 8, 9, 10, 11, 12, 13];

export const seed: MemoryData = {
  campaigns: [
    { id: "cmp_founders", name: "SaaS founders" },
    { id: "cmp_agencies", name: "Agency owners" },
  ],
  stats: DAYS.flatMap((day) => [
    {
      campaignId: "cmp_founders",
      counts: { bounced: 1, replied: 3, sent: 60 },
      date: `2026-11-${String(day).padStart(2, "0")}`,
    },
    {
      campaignId: "cmp_agencies",
      counts: { bounced: 2, replied: 6, sent: 80 },
      date: `2026-11-${String(day).padStart(2, "0")}`,
    },
  ]),
};
