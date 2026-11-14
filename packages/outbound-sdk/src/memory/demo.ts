import type { MemoryData } from "./data.ts";

const campaigns: MemoryData["campaigns"] = [
  {
    createdAt: "2026-10-01T09:00:00.000Z",
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
      startDate: "2026-10-05",
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
    createdAt: "2026-09-12T09:00:00.000Z",
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

const leads: MemoryData["leads"] = [
  {
    campaignId: "cmp_founders",
    company: "Example Co",
    createdAt: "2026-10-02T10:00:00.000Z",
    email: "person1@example.com",
    engagement: {
      lastContactedAt: "2026-10-05T14:00:00.000Z",
      lastRepliedAt: "2026-10-06T09:30:00.000Z",
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
    createdAt: "2026-10-03T10:00:00.000Z",
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
    createdAt: "2026-09-13T10:00:00.000Z",
    email: "person3@example.com",
    firstName: "Dana",
    id: "lead_3",
    lastName: "Demo",
    status: "bounced",
    title: "Owner",
  },
];

const messages: MemoryData["messages"] = [
  {
    body: "Hi Alex, saw your launch.",
    campaignId: "cmp_founders",
    direction: "out",
    id: "msg_1",
    leadId: "lead_1",
    senderId: "mbx_1",
    sentAt: "2026-10-05T14:00:00.000Z",
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
    sentAt: "2026-10-06T09:30:00.000Z",
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
    sentAt: "2026-10-05T14:05:00.000Z",
    stepIndex: 0,
    subject: "Congrats",
    variantKey: "B",
  },
];

const senders: MemoryData["senders"] = [
  {
    address: "outreach1@example.com",
    campaignIds: ["cmp_founders"],
    dailyLimit: 40,
    health: {
      checkedAt: "2026-10-06T00:00:00.000Z",
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
      checkedAt: "2026-10-06T00:00:00.000Z",
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

const stats: MemoryData["stats"] = [
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
    date: "2026-10-05",
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
    date: "2026-10-06",
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
    date: "2026-10-05",
  },
];

/**
 * A small made-up dataset for demos and docs: two campaigns, two mailboxes,
 * three leads, two days of stats, and one list, tag, webhook and block list
 * entry. No real people or companies.
 */
export const demoData = (): MemoryData => ({
  blocklist: [{ id: "blk_1", value: "competitor.example" }],
  campaigns,
  lists: [
    {
      createdAt: "2026-09-30T09:00:00.000Z",
      id: "lst_founders",
      name: "SaaS founders",
    },
  ],
  tags: [{ description: "Work for client A", id: "tag_a", name: "client-a" }],
  webhooks: [
    {
      events: ["reply_received"],
      id: "wh_1",
      name: "Replies",
      url: "https://hooks.example.com/replies",
    },
  ],
  leads,
  messages,
  senders,
  stats,
});
