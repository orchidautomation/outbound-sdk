// Made-up data for one workspace, "acme": two email campaigns with a week of
// daily results, per-step results for one of them, one sender and one reply.
import type { MemoryData, MemoryStats } from "outbound-sdk/memory";

const DAY = 86_400_000;
const TODAY = Date.parse("2026-11-14T00:00:00.000Z");

const day = (daysAgo: number): string =>
  new Date(TODAY - daysAgo * DAY).toISOString().slice(0, 10);

const week = (
  campaignId: string,
  counts: MemoryStats["counts"]
): MemoryStats[] =>
  Array.from({ length: 7 }, (_, index) => ({
    campaignId,
    counts,
    date: day(index + 1),
  }));

export const seed: MemoryData = {
  campaigns: [
    { id: "cmp_founders", name: "SaaS founders" },
    { id: "cmp_agencies", name: "Agency owners" },
  ],
  leads: [
    {
      campaignId: "cmp_founders",
      email: "dana@example.com",
      firstName: "Dana",
      id: "lead_dana",
      status: "replied",
    },
  ],
  messages: [
    {
      body: "Yes, send me the deck. Thursday works.",
      campaignId: "cmp_founders",
      category: "positive",
      direction: "in",
      id: "msg_dana",
      leadId: "lead_dana",
      sentAt: "2026-11-12T09:30:00.000Z",
    },
  ],
  senders: [
    {
      address: "ava@example.com",
      dailyLimit: 40,
      id: "snd_ava",
      warmup: { enabled: true, score: 96 },
    },
  ],
  stats: [
    // 50 sends a day to 20 new people, 2 replies a day.
    ...week("cmp_founders", { contacted: 20, replied: 2, sent: 50 }),
    // 30 sends a day to 10 new people, 1 reply a day.
    ...week("cmp_agencies", { contacted: 10, replied: 1, sent: 30 }),
    // The same week for SaaS founders, by step: the follow-up gets the replies.
    {
      campaignId: "cmp_founders",
      counts: { replied: 4, sent: 140 },
      date: day(1),
      stepIndex: 0,
    },
    {
      campaignId: "cmp_founders",
      counts: { replied: 10, sent: 210 },
      date: day(1),
      stepIndex: 1,
    },
  ],
};
