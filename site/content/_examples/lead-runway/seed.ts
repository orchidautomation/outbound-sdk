// Made-up campaigns for the client "acme", each with a different number of
// leads left to contact.
import type { LeadStatus } from "outbound-sdk";
import type { MemoryData, MemoryLead, MemoryStats } from "outbound-sdk/memory";

const DAY = 86_400_000;
const TODAY = Date.parse("2026-11-14T00:00:00.000Z");

const daily = (
  campaignId: string,
  counts: MemoryStats["counts"]
): MemoryStats[] =>
  Array.from({ length: 21 }, (_, index) => ({
    campaignId,
    counts,
    date: new Date(TODAY - (index + 1) * DAY).toISOString().slice(0, 10),
  }));

const leads = (
  campaignId: string,
  status: LeadStatus,
  count: number
): MemoryLead[] =>
  Array.from({ length: count }, (_, index) => ({
    campaignId,
    email: `${campaignId}.${status}.${index}@example.com`,
    id: `${campaignId}_${status}_${index}`,
    status,
  }));

export const seed: MemoryData = {
  campaigns: [
    { id: "cmp_agencies", name: "Agency owners" },
    { id: "cmp_founders", name: "SaaS founders" },
    { id: "cmp_ecom", name: "Ecommerce ops" },
    // Launched today: leads loaded, nothing sent yet.
    { id: "cmp_new", name: "Fintech CFOs" },
    { id: "cmp_paused", name: "Old list", status: "paused" },
  ],
  leads: [
    ...leads("cmp_agencies", "active", 400),
    ...leads("cmp_agencies", "replied", 40),
    ...leads("cmp_founders", "active", 40),
    ...leads("cmp_founders", "completed", 300),
    ...leads("cmp_founders", "replied", 60),
    ...leads("cmp_ecom", "completed", 580),
    ...leads("cmp_ecom", "bounced", 30),
    ...leads("cmp_ecom", "replied", 20),
    ...leads("cmp_new", "active", 120),
    ...leads("cmp_paused", "active", 90),
  ],
  stats: [
    ...daily("cmp_agencies", { contacted: 25, replied: 3, sent: 80 }),
    ...daily("cmp_founders", { contacted: 20, replied: 3, sent: 60 }),
    ...daily("cmp_ecom", { contacted: 30, replied: 1, sent: 90 }),
  ],
};
