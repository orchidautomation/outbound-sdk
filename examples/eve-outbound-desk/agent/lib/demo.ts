// Made-up data for `OUTBOUND_SDK_PROVIDER=memory`: three weeks of results that
// end yesterday, so "the last 7 days" always has something in it. Every name
// and address is invented.
//
// Acme (email): one steady campaign, one whose replies doubled last week, and
//   one whose bounces jumped, with a sender in error and an unanswered
//   positive reply.
// Globex (LinkedIn): one campaign with no bounce count at all, the way a
//   LinkedIn tool reports it, so its bounce rate is "not reported", not 0%.

import type { MemoryData, MemoryStats } from "outbound-sdk/memory";

const DAY = 86_400_000;

const dayAgo = (today: number, daysAgo: number): string =>
  new Date(today - daysAgo * DAY).toISOString().slice(0, 10);

const daily = (
  today: number,
  campaignId: string,
  perDay: (daysAgo: number) => MemoryStats["counts"]
): MemoryStats[] =>
  Array.from({ length: 21 }, (_, index) => ({
    campaignId,
    counts: perDay(index + 1),
    date: dayAgo(today, index + 1),
  }));

const leads = (campaignId: string, prefix: string, count: number) =>
  Array.from({ length: count }, (_, index) => ({
    campaignId,
    email: `${prefix}${index}@example.com`,
    firstName: `Lead${index}`,
    id: `lead_${prefix}${index}`,
    status: "active" as const,
  }));

const acme = (today: number): MemoryData => ({
  campaigns: [
    { id: "cmp_founders", name: "SaaS founders", tags: ["acme"] },
    { id: "cmp_agencies", name: "Agency owners", tags: ["acme"] },
    { id: "cmp_ecom", name: "Ecommerce ops", tags: ["acme"] },
  ],
  leads: [
    ...leads("cmp_founders", "founder", 40),
    ...leads("cmp_agencies", "owner", 400),
    {
      campaignId: "cmp_agencies",
      company: "Northwind Studio",
      email: "dana@northwind.example",
      firstName: "Dana",
      id: "lead_dana",
      interest: "interested",
      status: "replied",
    },
  ],
  messages: [
    {
      campaignId: "cmp_agencies",
      direction: "out",
      id: "msg_out_dana",
      leadId: "lead_dana",
      sentAt: new Date(today - 3 * DAY).toISOString(),
      subject: "Idea for Northwind Studio",
      threadId: "thr_dana",
    },
    {
      body: "This is timely. Can you send over a few times for a call next week?",
      campaignId: "cmp_agencies",
      category: "positive",
      direction: "in",
      id: "msg_in_dana",
      leadId: "lead_dana",
      sentAt: new Date(today - 2 * DAY).toISOString(),
      subject: "Re: Idea for Northwind Studio",
      threadId: "thr_dana",
    },
  ],
  senders: [
    {
      address: "alex@acme-mail.example",
      campaignIds: ["cmp_founders", "cmp_agencies"],
      dailyLimit: 50,
      id: "snd_alex",
      status: "active",
      warmup: { enabled: true, score: 97 },
    },
    {
      address: "sam@acme-mail.example",
      campaignIds: ["cmp_ecom"],
      dailyLimit: 50,
      id: "snd_sam",
      status: "error",
      warmup: { enabled: true, score: 61 },
    },
  ],
  stats: [
    // Steady: 60 sends a day, 3 replies.
    ...daily(today, "cmp_founders", () => ({
      bounced: 1,
      contacted: 20,
      positive: 1,
      replied: 3,
      sent: 60,
    })),
    // Replies doubled in the last seven days.
    ...daily(today, "cmp_agencies", (daysAgo) => ({
      bounced: 1,
      contacted: 25,
      positive: daysAgo <= 7 ? 2 : 1,
      replied: daysAgo <= 7 ? 6 : 3,
      sent: 80,
    })),
    // Bounces went from 1 a day to 9 a day in the last seven days.
    ...daily(today, "cmp_ecom", (daysAgo) => ({
      bounced: daysAgo <= 7 ? 9 : 1,
      contacted: 30,
      replied: 1,
      sent: 90,
    })),
  ],
});

const globex = (today: number): MemoryData => ({
  campaigns: [
    {
      channel: "linkedin",
      id: "cmp_cfo",
      name: "CFOs, Series B",
      tags: ["globex"],
    },
  ],
  leads: leads("cmp_cfo", "cfo", 120),
  stats: daily(today, "cmp_cfo", (daysAgo) => ({
    connectionsAccepted: daysAgo <= 7 ? 6 : 8,
    connectionsSent: 20,
    contacted: 20,
    replied: 2,
    sent: 20,
  })),
});

const SEEDS = new Map([
  ["acme", acme],
  ["globex", globex],
]);

/** The demo data for one client, or an empty workspace for one not seeded. */
export const demoSeed = (clientId: string, now = Date.now()): MemoryData => {
  const today = Date.parse(
    `${new Date(now).toISOString().slice(0, 10)}T00:00:00.000Z`
  );

  return SEEDS.get(clientId)?.(today) ?? { campaigns: [] };
};
