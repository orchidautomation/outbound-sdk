// One client, "acme": two campaigns, five leads and their messages. `later`
// is the same account an hour on: one new lead, one new reply, one lead gone.
import type {
  MemoryData,
  MemoryLead,
  MemoryMessage,
} from "outbound-sdk/memory";

const lead = (
  id: string,
  campaignId: string,
  email: string,
  createdAt: string
): MemoryLead => ({ campaignId, createdAt, email, id });

const sent = (id: string, leadId: string, sentAt: string): MemoryMessage => ({
  campaignId: "cmp_founders",
  direction: "out",
  id,
  leadId,
  sentAt,
});

const reply = (
  id: string,
  leadId: string,
  sentAt: string,
  category: "negative" | "positive"
): MemoryMessage => ({
  campaignId: "cmp_founders",
  category,
  direction: "in",
  id,
  leadId,
  sentAt,
});

const LEADS: readonly MemoryLead[] = [
  lead("lead_1", "cmp_founders", "ana@example.com", "2026-11-10T09:00:00Z"),
  lead("lead_2", "cmp_founders", "ben@example.com", "2026-11-10T09:00:00Z"),
  lead("lead_3", "cmp_founders", "caro@example.com", "2026-11-11T09:00:00Z"),
  lead("lead_4", "cmp_agencies", "dev@example.com", "2026-11-12T09:00:00Z"),
  lead("lead_5", "cmp_agencies", "eli@example.com", "2026-11-13T09:00:00Z"),
];

const MESSAGES: readonly MemoryMessage[] = [
  sent("msg_1", "lead_1", "2026-11-11T08:00:00Z"),
  sent("msg_2", "lead_2", "2026-11-11T08:05:00Z"),
  reply("msg_3", "lead_1", "2026-11-12T10:30:00Z", "positive"),
  reply("msg_4", "lead_2", "2026-11-13T16:45:00Z", "negative"),
];

const CAMPAIGNS = [
  { id: "cmp_founders", name: "SaaS founders" },
  { id: "cmp_agencies", name: "Agency owners" },
];

export const seed: MemoryData = {
  campaigns: CAMPAIGNS,
  leads: LEADS,
  messages: MESSAGES,
};

export const later: MemoryData = {
  campaigns: CAMPAIGNS,
  leads: [
    // lead_2 was deleted in the vendor's app.
    ...LEADS.filter((item) => item.id !== "lead_2"),
    lead("lead_6", "cmp_agencies", "fay@example.com", "2026-11-14T12:20:00Z"),
  ],
  messages: [
    ...MESSAGES,
    reply("msg_5", "lead_3", "2026-11-14T12:40:00Z", "positive"),
  ],
};
