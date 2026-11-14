// Three accounts. "acme" is a client on two tools, email and LinkedIn.
// "globex" is a client on the email tool only. "agency" is one email
// workspace that holds campaigns for several clients, told apart by tag.
import type { MemoryData } from "outbound-sdk/memory";

export const acmeEmail: MemoryData = {
  campaigns: [
    { id: "cmp_1", name: "Acme founders" },
    { id: "cmp_2", name: "Acme agencies" },
  ],
  stats: [
    {
      campaignId: "cmp_1",
      counts: { replied: 6, sent: 200 },
      date: "2026-11-12",
    },
    {
      campaignId: "cmp_2",
      counts: { replied: 4, sent: 100 },
      date: "2026-11-12",
    },
  ],
};

export const acmeLinkedin: MemoryData = {
  campaigns: [{ channel: "linkedin", id: "cmp_1", name: "Acme on LinkedIn" }],
  stats: [
    {
      campaignId: "cmp_1",
      counts: { connectionsAccepted: 12, connectionsSent: 40 },
      date: "2026-11-12",
    },
  ],
};

export const globexEmail: MemoryData = {
  campaigns: [{ id: "cmp_1", name: "Globex outreach" }],
  stats: [
    {
      campaignId: "cmp_1",
      counts: { replied: 1, sent: 50 },
      date: "2026-11-12",
    },
  ],
};

export const agency: MemoryData = {
  campaigns: [
    { id: "cmp_a", name: "Initech Q4", tags: ["initech"] },
    { id: "cmp_b", name: "Initech webinar", tags: ["initech"] },
    { id: "cmp_c", name: "Umbrella: founders", tags: [] },
    { id: "cmp_d", name: "Internal test", tags: [] },
  ],
  leads: [
    { campaignId: "cmp_a", email: "ana@example.com", id: "lead_1" },
    { campaignId: "cmp_c", email: "ben@example.com", id: "lead_2" },
    { campaignId: "cmp_d", email: "caro@example.com", id: "lead_3" },
  ],
  stats: [
    {
      campaignId: "cmp_a",
      counts: { replied: 5, sent: 100 },
      date: "2026-11-12",
    },
    {
      campaignId: "cmp_b",
      counts: { replied: 2, sent: 60 },
      date: "2026-11-12",
    },
    {
      campaignId: "cmp_c",
      counts: { replied: 3, sent: 90 },
      date: "2026-11-12",
    },
    {
      campaignId: "cmp_d",
      counts: { replied: 0, sent: 4 },
      date: "2026-11-12",
    },
  ],
};
