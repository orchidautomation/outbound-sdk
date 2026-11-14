// Made-up sending setup for the client "acme": two sending domains, one
// healthy and one in trouble, and three campaigns.
import type { MemoryData, MemoryHealth } from "outbound-sdk/memory";

const healthy: MemoryHealth = {
  blacklisted: false,
  connected: true,
  dkim: true,
  dmarc: true,
  mx: true,
  spf: true,
};

const DAY = "2026-11-13";

export const seed: MemoryData = {
  campaigns: [
    { id: "cmp_founders", name: "SaaS founders" },
    { id: "cmp_ecom", name: "Ecommerce ops" },
    { id: "cmp_new", name: "Agency owners" },
  ],
  senders: [
    {
      address: "ana@mail.example.com",
      campaignIds: ["cmp_founders", "cmp_new"],
      health: { ...healthy, warmup: { sent: 200, spam: 4 } },
      id: "snd_ana",
    },
    {
      address: "ben@mail.example.com",
      campaignIds: ["cmp_founders"],
      health: { ...healthy, warmup: { sent: 200, spam: 6 } },
      id: "snd_ben",
    },
    // DKIM fails, and a fifth of its warmup emails land in spam.
    {
      address: "cara@go.example.com",
      campaignIds: ["cmp_ecom"],
      health: { ...healthy, dkim: false, warmup: { sent: 150, spam: 30 } },
      id: "snd_cara",
    },
    // The vendor lost its connection to this mailbox.
    {
      address: "dan@go.example.com",
      campaignIds: ["cmp_ecom"],
      health: { ...healthy, connected: false, dkim: false },
      id: "snd_dan",
      status: "disconnected",
    },
  ],
  stats: [
    // Per campaign.
    {
      campaignId: "cmp_founders",
      counts: { bounced: 14, sent: 1400 },
      date: DAY,
    },
    { campaignId: "cmp_ecom", counts: { bounced: 54, sent: 900 }, date: DAY },
    { campaignId: "cmp_new", counts: { bounced: 3, sent: 40 }, date: DAY },
    // Per sender, over everything the sender sent.
    {
      campaignId: "cmp_founders",
      counts: { bounced: 8, sent: 740 },
      date: DAY,
      senderId: "snd_ana",
    },
    {
      campaignId: "cmp_founders",
      counts: { bounced: 9, sent: 700 },
      date: DAY,
      senderId: "snd_ben",
    },
    {
      campaignId: "cmp_ecom",
      counts: { bounced: 46, sent: 500 },
      date: DAY,
      senderId: "snd_cara",
    },
    {
      campaignId: "cmp_ecom",
      counts: { bounced: 8, sent: 400 },
      date: DAY,
      senderId: "snd_dan",
    },
  ],
};
