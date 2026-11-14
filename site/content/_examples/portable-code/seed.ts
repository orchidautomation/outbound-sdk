// Made-up data: three campaigns in different states, a week of results for
// the active one in total and by step, its settings, and two replies.
import type { MemoryData, MemoryStats } from "outbound-sdk/memory";

const DAY = 86_400_000;
const TODAY = Date.parse("2026-11-14T00:00:00.000Z");

const day = (daysAgo: number): string =>
  new Date(TODAY - daysAgo * DAY).toISOString().slice(0, 10);

const week = (counts: MemoryStats["counts"]): MemoryStats[] =>
  Array.from({ length: 7 }, (_, index) => ({
    campaignId: "cmp_founders",
    counts,
    date: day(index + 1),
  }));

const weekOfStep = (
  stepIndex: number,
  counts: MemoryStats["counts"]
): MemoryStats[] => week(counts).map((row) => ({ ...row, stepIndex }));

export const seed: MemoryData = {
  campaigns: [
    {
      id: "cmp_founders",
      name: "SaaS founders",
      settings: { dailyLimit: 60, stopOnReply: true, trackOpens: false },
    },
    { id: "cmp_agencies", name: "Agency owners", status: "paused" },
    { id: "cmp_spring", name: "Spring webinar", status: "completed" },
  ],
  messages: [
    {
      campaignId: "cmp_founders",
      category: "positive",
      direction: "in",
      id: "msg_1",
      sentAt: "2026-11-12T09:30:00.000Z",
    },
    {
      campaignId: "cmp_founders",
      category: "negative",
      direction: "in",
      id: "msg_2",
      sentAt: "2026-11-13T15:05:00.000Z",
    },
  ],
  stats: [
    // 60 sends a day to 20 new people, 3 replies. No open count: open
    // tracking is off for this campaign.
    ...week({ contacted: 20, replied: 3, sent: 60 }),
    // The same sends by step: 20 first emails and 40 follow-ups a day.
    ...weekOfStep(0, { replied: 2, sent: 20 }),
    ...weekOfStep(1, { replied: 1, sent: 40 }),
  ],
};
