// Made-up data for one tool: five mailboxes on three sending domains, one
// LinkedIn seat, and four active campaigns. The domain send-two.example.com is
// in trouble, and "Agency owners" is set up carelessly.
import type { MemoryData, MemoryStats } from "outbound-sdk/memory";

const WEEKDAYS = [1, 2, 3, 4, 5];

const HEALTHY = {
  blacklisted: false,
  connected: true,
  dkim: true,
  dmarc: true,
  mx: true,
  spf: true,
};

// One row per day for the seven days before 2026-11-14.
const daily = (
  campaignId: string,
  counts: MemoryStats["counts"]
): MemoryStats[] =>
  Array.from({ length: 7 }, (_, index) => ({
    campaignId,
    counts,
    date: `2026-11-${String(7 + index).padStart(2, "0")}`,
  }));

export const seed: MemoryData = {
  campaigns: [
    {
      id: "founders",
      name: "SaaS founders",
      settings: {
        dailyLimit: 60,
        gapMinutes: 10,
        schedule: [
          {
            days: WEEKDAYS,
            from: "09:00",
            timezone: "America/New_York",
            to: "17:00",
          },
        ],
        stopOnReply: true,
        trackClicks: false,
        trackOpens: false,
      },
    },
    {
      id: "agencies",
      name: "Agency owners",
      settings: {
        dailyLimit: 200,
        endDate: "2026-10-31",
        gapMinutes: 2,
        schedule: [{ days: [...WEEKDAYS, 6], from: "06:00", to: "22:00" }],
        stopOnReply: false,
        trackClicks: true,
        trackOpens: true,
      },
    },
    // No settings at all: the tool reports nothing for this campaign.
    { id: "ecom", name: "Ecommerce ops" },
    {
      channel: "linkedin",
      id: "linkedin",
      name: "LinkedIn founders",
      settings: {
        dailyLimit: 20,
        schedule: [
          {
            days: WEEKDAYS,
            from: "09:00",
            timezone: "Europe/London",
            to: "17:00",
          },
        ],
        stopOnReply: true,
      },
    },
  ],
  senders: [
    {
      address: "ana@send-one.example.com",
      campaignIds: ["founders", "agencies", "ecom"],
      dailyLimit: 40,
      health: { ...HEALTHY, warmup: { sent: 200, spam: 4 } },
      id: "ana",
      warmup: { enabled: true, score: 98 },
    },
    {
      address: "ben@send-one.example.com",
      campaignIds: ["founders"],
      dailyLimit: 40,
      health: { ...HEALTHY, warmup: { sent: 200, spam: 6 } },
      id: "ben",
      warmup: { enabled: true, score: 95 },
    },
    {
      address: "cy@send-two.example.com",
      campaignIds: ["agencies"],
      dailyLimit: 30,
      health: {
        ...HEALTHY,
        dkim: false,
        dmarc: false,
        warmup: { sent: 100, spam: 18 },
      },
      id: "cy",
      warmup: { enabled: true, score: 72 },
    },
    {
      address: "dee@send-two.example.com",
      campaignIds: ["agencies"],
      dailyLimit: 30,
      health: {
        ...HEALTHY,
        blacklisted: true,
        connected: false,
        dkim: false,
        dmarc: false,
        issues: ["Sign-in failed"],
        warmup: { sent: 100, spam: 12 },
      },
      id: "dee",
      status: "disconnected",
      warmup: { enabled: false },
    },
    // A new mailbox: attached to nothing, and nothing reported about it.
    { address: "eli@send-three.example.com", id: "eli" },
    {
      campaignIds: ["linkedin"],
      dailyLimit: 20,
      health: { connected: true },
      id: "fay",
      linkedinUrl: "https://www.linkedin.com/in/fay-lin-example",
      name: "Fay Lin",
    },
  ],
  stats: [
    ...daily("founders", { bounced: 1, sent: 50 }),
    ...daily("agencies", { bounced: 3, sent: 40 }),
    ...daily("ecom", { bounced: 1, sent: 10 }),
    // The LinkedIn tool counts no bounces.
    ...daily("linkedin", { sent: 15 }),
    // What each sender of "Agency owners" sent in all its campaigns.
    {
      campaignId: "agencies",
      counts: { bounced: 6, sent: 420 },
      date: "2026-11-13",
      senderId: "ana",
    },
    {
      campaignId: "agencies",
      counts: { bounced: 12, sent: 150 },
      date: "2026-11-13",
      senderId: "cy",
    },
    {
      campaignId: "agencies",
      counts: { bounced: 9, sent: 90 },
      date: "2026-11-13",
      senderId: "dee",
    },
  ],
};
