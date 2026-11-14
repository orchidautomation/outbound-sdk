import type { MemoryData } from "outbound-sdk/memory";

// Every seed type the in-memory adapter takes. Only `id` is required on most
// of them; everything left out gets a default or `null`.
export const seed: MemoryData = {
  blocklist: [
    // `kind` defaults to `email` when the value has an @, else `domain`.
    { id: "blk_1", value: "rival.example" },
    { id: "blk_2", value: "optout@example.com" },
  ],
  campaigns: [
    {
      createdAt: "2026-10-26T09:00:00.000Z",
      id: "cmp_ops",
      name: "Ops leaders",
      settings: {
        dailyLimit: 60,
        schedule: [
          {
            days: [1, 2, 3, 4, 5],
            from: "09:00",
            timezone: "Europe/London",
            to: "17:00",
          },
        ],
        stopOnReply: true,
        trackOpens: false,
      },
      status: "active",
      steps: [
        {
          delayDays: 0,
          variants: [
            { body: "Hi, a quick question.", subject: "Question" },
            { body: "Hi, one idea for you.", subject: "Idea" },
          ],
        },
        { delayDays: 3, variants: [{ body: "Following up." }] },
      ],
      subsequences: [
        {
          id: "sub_ooo",
          name: "Back from leave",
          steps: [{ delayDays: 7, variants: [{ body: "Welcome back." }] }],
        },
      ],
      tags: ["acme"],
    },
    { channel: "linkedin", id: "cmp_li", status: "paused" },
  ],
  leads: [
    {
      campaignId: "cmp_ops",
      company: "Example Co",
      createdAt: "2026-11-02T10:00:00.000Z",
      custom: { region: "EMEA" },
      email: "person1@example.com",
      engagement: { opens: 3, replies: 1, stepIndex: 1 },
      firstName: "Alex",
      id: "lead_1",
      interest: "Interested",
      lastName: "Example",
      listIds: ["lst_ops"],
      status: "replied",
      tags: ["priority"],
      title: "COO",
    },
    {
      campaignId: "cmp_ops",
      createdAt: "2026-11-09T10:00:00.000Z",
      email: "person2@example.com",
      id: "lead_2",
      listIds: ["lst_ops"],
    },
    {
      campaignId: "cmp_li",
      id: "lead_3",
      linkedinUrl: "https://www.linkedin.com/in/example-person-3",
    },
  ],
  lists: [{ id: "lst_ops", name: "Ops leaders, UK" }],
  messages: [
    {
      body: "Hi, a quick question.",
      campaignId: "cmp_ops",
      direction: "out",
      id: "msg_1",
      leadId: "lead_1",
      senderId: "mbx_1",
      sentAt: "2026-11-10T09:15:00.000Z",
      stepIndex: 0,
      subject: "Question",
      threadId: "thr_1",
      variantKey: "A",
    },
    {
      body: "Yes, send me times.",
      campaignId: "cmp_ops",
      category: "positive",
      direction: "in",
      id: "msg_2",
      isAuto: false,
      leadId: "lead_1",
      senderId: "mbx_1",
      sentAt: "2026-11-11T08:40:00.000Z",
      threadId: "thr_1",
    },
  ],
  senders: [
    {
      address: "sales@example.com",
      campaignIds: ["cmp_ops"],
      dailyLimit: 40,
      health: { connected: true, dkim: true, dmarc: false, spf: true },
      id: "mbx_1",
      warmup: { enabled: true, score: 94 },
    },
    {
      campaignIds: ["cmp_li"],
      id: "li_1",
      linkedinUrl: "https://www.linkedin.com/in/example-sender-1",
    },
  ],
  stats: [
    // A row with no senderId and no stepIndex counts for its campaign and
    // for the workspace.
    {
      campaignId: "cmp_ops",
      counts: { bounced: 2, opened: 31, replied: 5, sent: 80 },
      date: "2026-11-10",
    },
    {
      campaignId: "cmp_ops",
      counts: { bounced: 1, opened: 12, replied: 3, sent: 40 },
      date: "2026-11-11",
    },
    // Per-step and per-sender numbers are rows of their own.
    {
      campaignId: "cmp_ops",
      counts: { replied: 6, sent: 90 },
      date: "2026-11-11",
      stepIndex: 0,
    },
    {
      campaignId: "cmp_ops",
      counts: { replied: 2, sent: 30 },
      date: "2026-11-11",
      stepIndex: 1,
    },
    {
      campaignId: "cmp_ops",
      counts: { replied: 8, sent: 120 },
      date: "2026-11-11",
      senderId: "mbx_1",
    },
  ],
  tags: [{ id: "tag_acme", name: "acme" }],
  webhooks: [
    {
      campaignId: "cmp_ops",
      events: ["reply_received"],
      id: "wh_1",
      url: "https://hooks.example.com/replies",
    },
  ],
};
