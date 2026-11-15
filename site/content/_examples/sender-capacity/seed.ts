// Made-up senders and campaigns for the client "acme": five mailboxes, two
// running campaigns and a week of sends.
import type { MemoryData, MemoryStats } from "outbound-sdk/memory";

const DAY = 86_400_000;
const TODAY = Date.parse("2026-11-14T00:00:00.000Z");

const week = (campaignId: string, sent: number): MemoryStats[] =>
  Array.from({ length: 7 }, (_, index) => ({
    campaignId,
    counts: { sent },
    date: new Date(TODAY - (index + 1) * DAY).toISOString().slice(0, 10),
  }));

export const seed: MemoryData = {
  campaigns: [
    {
      id: "cmp_founders",
      name: "SaaS founders",
      settings: { dailyLimit: 40 },
    },
    { id: "cmp_ecom", name: "Ecommerce ops", settings: { dailyLimit: 70 } },
  ],
  senders: [
    {
      address: "ana@example.com",
      campaignIds: ["cmp_founders", "cmp_ecom"],
      dailyLimit: 30,
      id: "snd_ana",
      warmup: { enabled: true, score: 98 },
    },
    {
      address: "ben@example.com",
      campaignIds: ["cmp_founders"],
      dailyLimit: 30,
      id: "snd_ben",
      warmup: { enabled: true, score: 95 },
    },
    // Active, but its warmup score is under the bar.
    {
      address: "cara@example.com",
      campaignIds: ["cmp_ecom"],
      dailyLimit: 30,
      id: "snd_cara",
      warmup: { enabled: true, score: 72 },
    },
    // Paused in the vendor tool.
    {
      address: "dan@example.com",
      campaignIds: ["cmp_ecom"],
      dailyLimit: 30,
      id: "snd_dan",
      status: "paused",
      warmup: { enabled: true, score: 96 },
    },
    // Ready, and attached to no campaign.
    {
      address: "eve@example.com",
      dailyLimit: 30,
      id: "snd_eve",
      warmup: { enabled: true, score: 97 },
    },
  ],
  stats: [
    ...week("cmp_founders", 38),
    ...week("cmp_ecom", 55),
    // dan sent 60 of Ecommerce ops' sends before it was paused.
    {
      campaignId: "cmp_ecom",
      counts: { sent: 60 },
      date: "2026-11-08",
      senderId: "snd_dan",
    },
  ],
};
