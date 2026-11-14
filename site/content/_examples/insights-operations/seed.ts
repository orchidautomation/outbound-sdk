// Three weeks of made-up results for one client, "acme": four active
// campaigns and one paused pilot. Replies to "Agency owners" fell in the last
// seven days, and "Ecommerce ops" had a bounce spike on 2026-11-11.
import type { MemoryData, MemoryLead, MemoryStats } from "outbound-sdk/memory";

const DAY = 86_400_000;
const TODAY = Date.parse("2026-11-14T00:00:00.000Z");

const day = (daysAgo: number): string =>
  new Date(TODAY - daysAgo * DAY).toISOString().slice(0, 10);

// One row per day for the 21 days before today.
const daily = (
  campaignId: string,
  perDay: (daysAgo: number) => MemoryStats["counts"]
): MemoryStats[] =>
  Array.from({ length: 21 }, (_, index) => ({
    campaignId,
    counts: perDay(index + 1),
    date: day(index + 1),
  }));

const leads = (
  campaignId: string,
  status: NonNullable<MemoryLead["status"]>,
  count: number
): MemoryLead[] =>
  Array.from({ length: count }, (_, index) => ({
    campaignId,
    email: `${campaignId}.${status}.${index}@example.com`,
    id: `${campaignId}_${status}_${index}`,
    status,
  }));

export const seed: MemoryData = {
  campaigns: [
    { id: "founders", name: "SaaS founders", tags: ["saas"] },
    { id: "agencies", name: "Agency owners", tags: ["agency"] },
    {
      id: "ecom",
      name: "Ecommerce ops",
      settings: {
        dailyLimit: 80,
        schedule: [
          {
            days: [1, 2, 3, 4, 5],
            from: "09:00",
            timezone: "America/Chicago",
            to: "12:00",
          },
        ],
        trackOpens: false,
      },
      steps: [
        { variants: [{ body: "Hi {{firstName}}", subject: "Returns" }] },
        { delayDays: 3, variants: [{ body: "Following up." }] },
      ],
      tags: ["ecommerce"],
    },
    {
      channel: "linkedin",
      id: "linkedin",
      name: "LinkedIn founders",
      tags: ["saas"],
    },
    { id: "pilot", name: "Pilot test", status: "paused" },
  ],
  leads: [
    ...leads("founders", "active", 100),
    ...leads("founders", "replied", 40),
    ...leads("founders", "completed", 45),
    ...leads("founders", "bounced", 10),
    ...leads("founders", "unsubscribed", 5),
    ...leads("agencies", "active", 450),
    ...leads("ecom", "active", 400),
    ...leads("linkedin", "active", 300),
  ],
  senders: [
    {
      address: "ana@send.example.com",
      campaignIds: ["ecom"],
      dailyLimit: 40,
      id: "ana",
    },
    {
      address: "ben@send.example.com",
      campaignIds: ["ecom"],
      dailyLimit: 40,
      id: "ben",
      status: "error",
    },
  ],
  stats: [
    // Steady: 3 replies a day from 50 new leads.
    ...daily("founders", () => ({
      bounced: 1,
      contacted: 50,
      positive: 1,
      replied: 3,
      sent: 100,
    })),
    // Replies fell from 4 a day to 1 a day in the last seven days.
    ...daily("agencies", (daysAgo) => ({
      bounced: 1,
      contacted: 40,
      positive: daysAgo <= 7 ? 0 : 1,
      replied: daysAgo <= 7 ? 1 : 4,
      sent: 100,
    })),
    // Bounces alternate between 1 and 3 a day, then 14 on 2026-11-11.
    ...daily("ecom", (daysAgo) => ({
      bounced: daysAgo === 3 ? 14 : 1 + (daysAgo % 2) * 2,
      contacted: 50,
      positive: 0,
      replied: 1,
      sent: 80,
    })),
    // The LinkedIn tool counts no bounces.
    ...daily("linkedin", () => ({
      connectionsAccepted: 6,
      connectionsSent: 15,
      contacted: 15,
      positive: 1,
      replied: 2,
      sent: 30,
    })),
    // One day in September: 2 replies from 20 leads.
    {
      campaignId: "pilot",
      counts: { bounced: 0, contacted: 20, positive: 1, replied: 2, sent: 60 },
      date: "2026-09-15",
    },
  ],
};
