// Made-up data for one workspace: two email campaigns with a week of daily
// counts each. The vendor reported no bounce count for "Agency owners".
import type { MemoryData, MemoryStats } from "outbound-sdk/memory";

const DAY = 86_400_000;
const TODAY = Date.parse("2026-11-14T00:00:00.000Z");

const week = (
  campaignId: string,
  counts: MemoryStats["counts"]
): MemoryStats[] =>
  Array.from({ length: 7 }, (_, index) => ({
    campaignId,
    counts,
    date: new Date(TODAY - (index + 1) * DAY).toISOString().slice(0, 10),
  }));

export const seed: MemoryData = {
  campaigns: [
    { id: "cmp_founders", name: "SaaS founders" },
    { id: "cmp_agencies", name: "Agency owners" },
  ],
  stats: [
    ...week("cmp_founders", {
      bounced: 1,
      contacted: 20,
      positive: 1,
      replied: 2,
      sent: 50,
    }),
    ...week("cmp_agencies", { contacted: 10, replied: 1, sent: 30 }),
  ],
};
