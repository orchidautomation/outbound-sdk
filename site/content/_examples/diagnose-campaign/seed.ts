// Five weeks of made-up results for the client "acme": two campaigns that
// are doing fine and one, "Ecommerce ops", that is not.
import type { MemoryData, MemoryStats } from "outbound-sdk/memory";

const DAY = 86_400_000;
const TODAY = Date.parse("2026-11-14T00:00:00.000Z");

const day = (daysAgo: number): string =>
  new Date(TODAY - daysAgo * DAY).toISOString().slice(0, 10);

const daily = (
  campaignId: string,
  perDay: (daysAgo: number) => MemoryStats["counts"]
): MemoryStats[] =>
  Array.from({ length: 35 }, (_, index) => ({
    campaignId,
    counts: perDay(index + 1),
    date: day(index + 1),
  }));

export const CAMPAIGN = "cmp_ecom";

export const seed: MemoryData = {
  campaigns: [
    { id: "cmp_founders", name: "SaaS founders" },
    { id: "cmp_agencies", name: "Agency owners" },
    {
      id: CAMPAIGN,
      name: "Ecommerce ops",
      settings: {
        dailyLimit: 100,
        // Monday to Friday, three hours a day.
        schedule: [
          {
            days: [1, 2, 3, 4, 5],
            from: "09:00",
            timezone: "Europe/Berlin",
            to: "12:00",
          },
        ],
        trackOpens: false,
      },
      steps: [
        { variants: [{ body: "Hi {{firstName}}.", subject: "Returns" }] },
        {
          delayDays: 4,
          variants: [{ body: "Any thoughts?", subject: "Returns" }],
        },
      ],
    },
  ],
  senders: [
    {
      address: "cara@example.com",
      campaignIds: [CAMPAIGN],
      dailyLimit: 50,
      id: "snd_cara",
    },
    {
      address: "dan@example.com",
      campaignIds: [CAMPAIGN],
      dailyLimit: 50,
      id: "snd_dan",
      status: "paused",
    },
  ],
  stats: [
    ...daily("cmp_founders", (daysAgo) => ({
      bounced: 1,
      contacted: 20,
      positive: daysAgo % 2,
      replied: 2,
      sent: 60,
    })),
    ...daily("cmp_agencies", (daysAgo) => ({
      bounced: 1,
      contacted: 25,
      positive: 1,
      replied: 2 + (daysAgo % 2),
      sent: 80,
    })),
    // Sends halved a week ago, when one mailbox was paused. Bounces spiked
    // on 2026-11-10. Two replies in five weeks, neither of them positive.
    ...daily(CAMPAIGN, (daysAgo) => ({
      bounced: daysAgo === 4 ? 14 : 2 + (daysAgo % 3),
      contacted: daysAgo <= 7 ? 15 : 30,
      positive: 0,
      replied: daysAgo % 12 === 0 ? 1 : 0,
      sent: daysAgo <= 7 ? 44 + (daysAgo % 2) * 2 : 88 + (daysAgo % 2) * 4,
    })),
  ],
};
