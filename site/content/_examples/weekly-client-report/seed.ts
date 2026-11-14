// Three weeks of made-up results for one client, "acme": two email campaigns
// that are doing fine and one whose bounces jumped last week.
import type { MemoryData, MemoryStats } from "outbound-sdk/memory";

const DAY = 86_400_000;
const TODAY = Date.parse("2026-11-14T00:00:00.000Z");

const day = (daysAgo: number): string =>
  new Date(TODAY - daysAgo * DAY).toISOString().slice(0, 10);

const daily = (
  campaignId: string,
  perDay: (daysAgo: number) => MemoryStats["counts"]
): MemoryStats[] =>
  Array.from({ length: 21 }, (_, index) => ({
    campaignId,
    counts: perDay(index + 1),
    date: day(index + 1),
  }));

export const seed: MemoryData = {
  campaigns: [
    { id: "cmp_founders", name: "SaaS founders", tags: ["acme"] },
    { id: "cmp_agencies", name: "Agency owners", tags: ["acme"] },
    { id: "cmp_ecom", name: "Ecommerce ops", tags: ["acme"] },
  ],
  leads: [
    ...Array.from({ length: 40 }, (_, index) => ({
      campaignId: "cmp_founders",
      email: `founder${index}@example.com`,
      id: `lead_f${index}`,
      status: "active" as const,
    })),
    ...Array.from({ length: 400 }, (_, index) => ({
      campaignId: "cmp_agencies",
      email: `owner${index}@example.com`,
      id: `lead_a${index}`,
      status: "active" as const,
    })),
  ],
  stats: [
    // Steady: 60 sends a day, 3 replies.
    ...daily("cmp_founders", () => ({
      bounced: 1,
      contacted: 20,
      replied: 3,
      sent: 60,
    })),
    // Replies doubled in the last seven days.
    ...daily("cmp_agencies", (daysAgo) => ({
      bounced: 1,
      contacted: 25,
      replied: daysAgo <= 7 ? 6 : 3,
      sent: 80,
    })),
    // Bounces went from 1 a day to 9 a day in the last seven days.
    ...daily("cmp_ecom", (daysAgo) => ({
      bounced: daysAgo <= 7 ? 9 : 1,
      contacted: 30,
      replied: 1,
      sent: 90,
    })),
  ],
};
