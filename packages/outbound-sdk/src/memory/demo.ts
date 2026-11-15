import type { MemoryData } from "./data.ts";

const DAY = 86_400_000;

/** Times counted back from the day `demoData()` is called for. */
interface Clock {
  /** `days` before the anchor's day, at `time` (UTC), as an ISO 8601 time. */
  readonly at: (days: number, time: string) => string;
  /** `days` before the anchor's day, as `YYYY-MM-DD` (UTC). */
  readonly day: (days: number) => string;
}

const clockAt = (now: number): Clock => {
  const today = Math.floor(now / DAY) * DAY;

  const day = (days: number): string =>
    new Date(today - days * DAY).toISOString().slice(0, 10);

  return {
    at: (days, time) => `${day(days)}T${time}:00.000Z`,
    day,
  };
};

const campaigns = ({
  at,
  day,
}: Clock): NonNullable<MemoryData["campaigns"]> => [
  {
    createdAt: at(16, "09:00"),
    id: "cmp_founders",
    name: "Q4 SaaS founders",
    settings: {
      dailyLimit: 80,
      dailyNewLeads: 30,
      gapMinutes: 12,
      schedule: [
        {
          days: [1, 2, 3, 4, 5],
          from: "09:00",
          name: "Weekdays",
          timezone: "America/New_York",
          to: "17:00",
        },
      ],
      startDate: day(12),
      stopOnAutoReply: false,
      stopOnReply: true,
      trackClicks: false,
      trackOpens: true,
    },
    status: "active",
    steps: [
      {
        delayDays: 0,
        variants: [
          {
            body: "Hi {{firstName}}, saw your launch.",
            subject: "Quick question",
          },
          {
            body: "Hi {{firstName}}, congrats on the launch.",
            subject: "Congrats",
          },
        ],
      },
      {
        delayDays: 3,
        variants: [
          { body: "Following up on my note.", subject: "Re: Quick question" },
        ],
      },
    ],
    tags: ["client-a"],
  },
  {
    createdAt: at(26, "09:00"),
    id: "cmp_agencies",
    name: "Agency owners",
    status: "paused",
    steps: [
      {
        delayDays: 0,
        variants: [
          { body: "Hello {{firstName}}.", subject: "Idea for {{company}}" },
        ],
      },
    ],
    tags: ["client-b"],
  },
];

const leads = ({ at }: Clock): NonNullable<MemoryData["leads"]> => [
  {
    campaignId: "cmp_founders",
    company: "Example Co",
    createdAt: at(15, "10:00"),
    email: "person1@example.com",
    engagement: {
      lastContactedAt: at(3, "14:00"),
      lastRepliedAt: at(2, "09:30"),
      opens: 2,
      replies: 1,
      stepIndex: 0,
    },
    firstName: "Alex",
    id: "lead_1",
    interest: "Interested",
    lastName: "Example",
    listIds: ["lst_founders"],
    status: "replied",
    title: "Founder",
  },
  {
    campaignId: "cmp_founders",
    company: "Sample Ltd",
    createdAt: at(14, "10:00"),
    email: "person2@example.com",
    firstName: "Sam",
    id: "lead_2",
    listIds: ["lst_founders"],
    lastName: "Sample",
    status: "active",
    title: "CEO",
  },
  {
    campaignId: "cmp_agencies",
    company: "Demo Agency",
    createdAt: at(25, "10:00"),
    email: "person3@example.com",
    firstName: "Dana",
    id: "lead_3",
    lastName: "Demo",
    status: "bounced",
    title: "Owner",
  },
];

const messages = ({ at }: Clock): NonNullable<MemoryData["messages"]> => [
  {
    body: "Hi Alex, saw your launch.",
    campaignId: "cmp_founders",
    direction: "out",
    id: "msg_1",
    leadId: "lead_1",
    senderId: "mbx_1",
    sentAt: at(3, "14:00"),
    stepIndex: 0,
    subject: "Quick question",
    threadId: "thr_1",
    variantKey: "A",
  },
  {
    body: "Thanks, happy to chat next week.",
    campaignId: "cmp_founders",
    category: "positive",
    direction: "in",
    id: "msg_2",
    isAuto: false,
    leadId: "lead_1",
    senderId: "mbx_1",
    sentAt: at(2, "09:30"),
    subject: "Re: Quick question",
    threadId: "thr_1",
  },
  {
    body: "Hi Sam, congrats on the launch.",
    campaignId: "cmp_founders",
    direction: "out",
    id: "msg_3",
    leadId: "lead_2",
    senderId: "mbx_2",
    sentAt: at(3, "14:05"),
    stepIndex: 0,
    subject: "Congrats",
    variantKey: "B",
  },
];

const senders = ({ at }: Clock): NonNullable<MemoryData["senders"]> => [
  {
    address: "outreach1@example.com",
    campaignIds: ["cmp_founders"],
    dailyLimit: 40,
    health: {
      checkedAt: at(2, "00:00"),
      connected: true,
      dkim: true,
      dmarc: true,
      mx: true,
      spf: true,
      warmup: { inbox: 96, received: 90, score: 96, sent: 100, spam: 4 },
    },
    id: "mbx_1",
    name: "Outreach One",
    warmup: { enabled: true, score: 96 },
  },
  {
    address: "outreach2@example.com",
    campaignIds: ["cmp_founders", "cmp_agencies"],
    dailyLimit: 40,
    health: {
      checkedAt: at(2, "00:00"),
      connected: true,
      dkim: false,
      dmarc: true,
      issues: ["DKIM selector not found"],
      mx: true,
      spf: true,
      warmup: { inbox: 75, received: 70, score: 88, sent: 100, spam: 25 },
    },
    id: "mbx_2",
    name: "Outreach Two",
    warmup: { enabled: true, score: 88 },
  },
];

const stats = ({ day }: Clock): NonNullable<MemoryData["stats"]> => [
  {
    campaignId: "cmp_founders",
    counts: {
      bounced: 1,
      contacted: 50,
      delivered: 49,
      opened: 30,
      positive: 2,
      replied: 4,
      sent: 50,
    },
    date: day(3),
  },
  {
    campaignId: "cmp_founders",
    counts: {
      bounced: 0,
      contacted: 40,
      delivered: 40,
      opened: 22,
      positive: 1,
      replied: 3,
      sent: 40,
    },
    date: day(2),
  },
  {
    campaignId: "cmp_agencies",
    counts: {
      bounced: 4,
      contacted: 60,
      delivered: 56,
      opened: 18,
      positive: 0,
      replied: 1,
      sent: 60,
    },
    date: day(3),
  },
  // The week before, so a seven-day report has a period to compare with.
  {
    campaignId: "cmp_founders",
    counts: {
      bounced: 1,
      contacted: 45,
      delivered: 44,
      opened: 25,
      positive: 1,
      replied: 2,
      sent: 45,
    },
    date: day(10),
  },
  {
    campaignId: "cmp_founders",
    counts: {
      bounced: 0,
      contacted: 45,
      delivered: 45,
      opened: 24,
      positive: 0,
      replied: 2,
      sent: 45,
    },
    date: day(9),
  },
  {
    campaignId: "cmp_agencies",
    counts: {
      bounced: 2,
      contacted: 55,
      delivered: 53,
      opened: 20,
      positive: 1,
      replied: 2,
      sent: 55,
    },
    date: day(10),
  },
];

export interface DemoDataOptions {
  /**
   * The moment the data is built for: every date is counted back from its
   * day. Defaults to now. Pass a fixed time for output that never changes.
   */
  readonly now?: Date | number | string | undefined;
}

/**
 * A small made-up dataset for demos and docs: two campaigns, two mailboxes,
 * three leads, three messages, two weeks of stats, and one list, tag, webhook
 * and block list entry. No real people or companies. Its dates sit in the two
 * weeks before `now`, so the reports over the last seven or fourteen days
 * find data on any day it is called.
 */
export const demoData = (options: DemoDataOptions = {}): MemoryData => {
  const now =
    options.now === undefined ? Date.now() : new Date(options.now).getTime();

  if (Number.isNaN(now)) {
    throw new TypeError(`demoData: now is not a date: ${String(options.now)}`);
  }

  const clock = clockAt(now);

  return {
    blocklist: [{ id: "blk_1", value: "competitor.example" }],
    campaigns: campaigns(clock),
    leads: leads(clock),
    lists: [
      {
        createdAt: clock.at(17, "09:00"),
        id: "lst_founders",
        name: "SaaS founders",
      },
    ],
    messages: messages(clock),
    senders: senders(clock),
    stats: stats(clock),
    tags: [{ description: "Work for client A", id: "tag_a", name: "client-a" }],
    webhooks: [
      {
        events: ["reply_received"],
        id: "wh_1",
        name: "Replies",
        url: "https://hooks.example.com/replies",
      },
    ],
  };
};
