// Your own seed: only an id is required, so state what the test is about and
// nothing else. Three campaigns: two active, one paused, one with no results.
import type { ReplyCategory } from "outbound-sdk";
import type { MemoryData, MemoryMessage } from "outbound-sdk/memory";

const reply = (
  id: string,
  campaignId: string,
  category: ReplyCategory
): MemoryMessage => ({
  campaignId,
  category,
  direction: "in",
  id,
  sentAt: "2026-11-12T10:00:00Z",
});

export const seed: MemoryData = {
  campaigns: [
    { id: "cmp_founders", name: "SaaS founders" },
    { id: "cmp_agencies", name: "Agency owners" },
    { id: "cmp_old", name: "Last quarter", status: "paused" },
  ],
  leads: Array.from({ length: 5 }, (_, index) => ({
    campaignId: "cmp_founders",
    company: "Northwind",
    email: `lead${index + 1}@northwind.example.com`,
    firstName: "Dana",
    id: `lead_${index + 1}`,
  })),
  messages: [
    reply("msg_1", "cmp_founders", "positive"),
    reply("msg_2", "cmp_founders", "positive"),
    reply("msg_3", "cmp_founders", "negative"),
  ],
  stats: [
    {
      campaignId: "cmp_founders",
      counts: { replied: 3, sent: 120 },
      date: "2026-11-12",
    },
    {
      campaignId: "cmp_founders",
      counts: { replied: 3, sent: 80 },
      date: "2026-11-13",
    },
    {
      campaignId: "cmp_old",
      counts: { replied: 9, sent: 900 },
      date: "2026-08-01",
    },
  ],
};
