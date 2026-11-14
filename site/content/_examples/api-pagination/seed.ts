import type { MemoryData } from "outbound-sdk/memory";

// Five leads in one campaign, enough for three pages of two.
export const seed: MemoryData = {
  campaigns: [{ id: "cmp_1", name: "Paging" }],
  leads: ["ada", "ben", "cy", "dee", "eli"].map((name, index) => ({
    campaignId: "cmp_1",
    email: `${name}@example.com`,
    id: `lead_${index + 1}`,
  })),
};
