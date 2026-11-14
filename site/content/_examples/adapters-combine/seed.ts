import type { MemoryData } from "outbound-sdk/memory";

// Client "acme" runs email and LinkedIn. Client "globex" runs email only.
export const acmeEmail: MemoryData = {
  campaigns: [
    { id: "cmp_1", name: "Acme founders" },
    { id: "cmp_2", name: "Acme agencies", status: "paused" },
  ],
  leads: [{ campaignId: "cmp_1", email: "person1@example.com", id: "lead_1" }],
  stats: [
    {
      campaignId: "cmp_1",
      counts: { replied: 6, sent: 200 },
      date: "2026-11-10",
    },
  ],
};

export const acmeLinkedin: MemoryData = {
  campaigns: [{ channel: "linkedin", id: "cmp_1", name: "Acme LinkedIn" }],
  leads: [
    {
      campaignId: "cmp_1",
      id: "lead_1",
      linkedinUrl: "https://www.linkedin.com/in/example-person-1",
    },
  ],
  stats: [
    {
      campaignId: "cmp_1",
      counts: { connectionsAccepted: 9, connectionsSent: 40 },
      date: "2026-11-10",
    },
  ],
};

export const globexEmail: MemoryData = {
  campaigns: [{ id: "cmp_1", name: "Globex CFOs" }],
  stats: [
    {
      campaignId: "cmp_1",
      counts: { replied: 2, sent: 90 },
      date: "2026-11-10",
    },
  ],
};
