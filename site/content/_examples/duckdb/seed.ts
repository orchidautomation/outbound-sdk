// One client, "acme": two campaigns, six leads, their messages and a week of
// daily stats. `later` is the same account an hour on: one new lead and one
// new reply.
import type {
  MemoryData,
  MemoryLead,
  MemoryMessage,
  MemoryStats,
} from "outbound-sdk/memory";

const lead = (
  id: string,
  campaignId: string,
  email: string,
  createdAt: string
): MemoryLead => ({ campaignId, createdAt, email, id });

const reply = (
  id: string,
  campaignId: string,
  leadId: string,
  sentAt: string,
  category: "negative" | "positive"
): MemoryMessage => ({
  campaignId,
  category,
  direction: "in",
  id,
  leadId,
  sentAt,
});

const day = (
  campaignId: string,
  date: string,
  sent: number,
  replied: number
): MemoryStats => ({
  campaignId,
  counts: { contacted: sent, replied, sent },
  date,
});

const CAMPAIGNS = [
  { id: "cmp_founders", name: "SaaS founders" },
  { id: "cmp_agencies", name: "Agency owners" },
];

const LEADS: readonly MemoryLead[] = [
  lead("lead_1", "cmp_founders", "ana@example.com", "2026-11-09T09:00:00Z"),
  lead("lead_2", "cmp_founders", "ben@example.com", "2026-11-09T09:00:00Z"),
  lead("lead_3", "cmp_founders", "caro@example.com", "2026-11-10T09:00:00Z"),
  lead("lead_4", "cmp_agencies", "dev@example.com", "2026-11-10T09:00:00Z"),
  lead("lead_5", "cmp_agencies", "eli@example.com", "2026-11-11T09:00:00Z"),
];

const MESSAGES: readonly MemoryMessage[] = [
  reply("msg_1", "cmp_founders", "lead_1", "2026-11-11T10:30:00Z", "positive"),
  reply("msg_2", "cmp_founders", "lead_2", "2026-11-12T16:45:00Z", "negative"),
  reply("msg_3", "cmp_agencies", "lead_4", "2026-11-13T08:10:00Z", "positive"),
];

const STATS: readonly MemoryStats[] = [
  day("cmp_founders", "2026-11-10", 120, 3),
  day("cmp_founders", "2026-11-11", 110, 4),
  day("cmp_founders", "2026-11-12", 90, 2),
  day("cmp_agencies", "2026-11-10", 60, 1),
  day("cmp_agencies", "2026-11-11", 80, 0),
  day("cmp_agencies", "2026-11-12", 70, 2),
];

export const seed: MemoryData = {
  campaigns: CAMPAIGNS,
  leads: LEADS,
  messages: MESSAGES,
  stats: STATS,
};

export const later: MemoryData = {
  ...seed,
  leads: [
    ...LEADS,
    lead("lead_6", "cmp_agencies", "fay@example.com", "2026-11-14T12:20:00Z"),
  ],
  messages: [
    ...MESSAGES,
    reply(
      "msg_4",
      "cmp_founders",
      "lead_3",
      "2026-11-14T12:40:00Z",
      "positive"
    ),
  ],
};
