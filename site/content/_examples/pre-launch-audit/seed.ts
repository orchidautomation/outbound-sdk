// A made-up draft campaign for the client "acme", with the kinds of mistakes
// that are cheap to fix before launch and costly after.
import type { MemoryData } from "outbound-sdk/memory";

export const CAMPAIGN = "cmp_launch";

export const seed: MemoryData = {
  campaigns: [
    {
      id: CAMPAIGN,
      name: "Agency owners Q1",
      settings: {
        dailyLimit: 200,
        // Every day of the week, 14 hours a day, with no timezone.
        schedule: [{ days: [0, 1, 2, 3, 4, 5, 6], from: "08:00", to: "22:00" }],
        stopOnReply: false,
        trackOpens: true,
      },
      status: "draft",
      steps: [
        {
          variants: [
            {
              body: "Hi {{firstName}}, I saw {{company}} is hiring. We help with {{painPoint|your pipeline}}. Start a free trial at https://example.com/start or read https://example.com/case-study.\n\n{{senderSignature}}",
              subject: "Idea for {{company}}",
            },
            {
              body: "Hi {{firstName}, can I send you a two-line summary?",
              subject: "Idea for {{company}}",
            },
          ],
        },
        {
          delayDays: 3,
          variants: [
            {
              body: "Hi {{firstName|there}}, did my last note reach you?",
              subject: "Following up!!",
            },
          ],
        },
      ],
    },
    // A campaign that is already running. The audit leaves it alone.
    { id: "cmp_running", name: "SaaS founders", status: "active" },
  ],
  leads: [
    {
      campaignId: CAMPAIGN,
      company: "Northwind",
      custom: { painPoint: "slow follow-up" },
      email: "ana@example.com",
      firstName: "Ana",
      id: "lead_1",
    },
    {
      campaignId: CAMPAIGN,
      company: "Contoso",
      email: "ben@example.com",
      firstName: "Ben",
      id: "lead_2",
    },
    // No first name.
    {
      campaignId: CAMPAIGN,
      company: "Fabrikam",
      email: "info@example.com",
      id: "lead_3",
    },
    // No company.
    {
      campaignId: CAMPAIGN,
      email: "cara@example.com",
      firstName: "Cara",
      id: "lead_4",
    },
    // Neither.
    { campaignId: CAMPAIGN, email: "sales@example.com", id: "lead_5" },
  ],
  senders: [
    {
      address: "sam@example.com",
      campaignIds: [CAMPAIGN],
      dailyLimit: 30,
      id: "snd_1",
    },
    {
      address: "kim@example.com",
      campaignIds: [CAMPAIGN],
      dailyLimit: 30,
      id: "snd_2",
    },
  ],
};
