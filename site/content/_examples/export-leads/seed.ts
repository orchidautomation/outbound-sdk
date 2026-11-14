// One client with two campaigns, five leads and two replies. One company
// name holds a comma and one a quote, to show what the CSV writer does.
import type { MemoryData } from "outbound-sdk/memory";

export const seed: MemoryData = {
  campaigns: [
    { id: "cmp_founders", name: "SaaS founders" },
    { id: "cmp_agencies", name: "Agency owners" },
  ],
  leads: [
    {
      campaignId: "cmp_founders",
      company: "Northwind, Inc.",
      email: "ana@example.com",
      firstName: "Ana",
      id: "lead_1",
      lastName: "Ruiz",
    },
    {
      campaignId: "cmp_founders",
      company: 'The "Good" Company',
      email: "ben@example.com",
      firstName: "Ben",
      id: "lead_2",
      lastName: "Okafor",
      status: "replied",
    },
    {
      campaignId: "cmp_founders",
      email: "caro@example.com",
      firstName: "Caro",
      id: "lead_3",
    },
    {
      campaignId: "cmp_agencies",
      company: "Lumen Studio",
      email: "dev@example.com",
      firstName: "Dev",
      id: "lead_4",
      lastName: "Shah",
    },
    {
      campaignId: "cmp_agencies",
      company: "Lumen Studio",
      email: "eli@example.com",
      firstName: "Eli",
      id: "lead_5",
      lastName: "Brandt",
      status: "bounced",
    },
  ],
  messages: [
    {
      campaignId: "cmp_founders",
      category: "positive",
      direction: "in",
      id: "msg_1",
      leadId: "lead_2",
      sentAt: "2026-11-12T10:30:00Z",
      subject: "Re: Quick question",
    },
    {
      campaignId: "cmp_agencies",
      category: "ooo",
      direction: "in",
      id: "msg_2",
      leadId: "lead_4",
      sentAt: "2026-11-13T07:15:00Z",
      subject: "Out of office",
    },
  ],
};
