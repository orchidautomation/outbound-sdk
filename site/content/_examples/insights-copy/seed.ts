// Made-up data for one email tool: a campaign with two A/B tested steps and a
// careless third step, and a second campaign that reuses two pieces of copy.
import type {
  MemoryData,
  MemoryMessage,
  MemoryStats,
} from "outbound-sdk/memory";

const OPENER = {
  body: "Hi {{firstName}}, I saw {{company}} is hiring two account executives. Worth a short call next week?",
  subject: "Quick question about {{company}}",
};

const FOLLOW_UP = { body: "Hi {{firstName}}, did my note reach you?" };

const pair = (
  lead: string,
  sentAt: string,
  ...repliedAt: string[]
): MemoryMessage[] => [
  {
    campaignId: "founders",
    direction: "out",
    id: `${lead}_out`,
    leadId: lead,
    sentAt,
    threadId: `thread_${lead}`,
  },
  ...repliedAt.map((at, index) => ({
    campaignId: "founders",
    direction: "in" as const,
    id: `${lead}_in${index}`,
    leadId: lead,
    sentAt: at,
    threadId: `thread_${lead}`,
  })),
];

/** One step's counts. A row with a `variantKey` is one variant of the step. */
const step = (
  campaignId: string,
  stepIndex: number,
  counts: { replied: number; sent: number }
): MemoryStats => ({ campaignId, counts, date: "2026-11-10", stepIndex });

export const seed: MemoryData = {
  campaigns: [
    {
      id: "founders",
      name: "SaaS founders",
      steps: [
        {
          variants: [
            OPENER,
            {
              body: "Hi {{firstName}}, most teams your size lose a day a week to manual follow-up. Want to see how {{company}} could get it back?",
              subject: "Idea for {{company}}",
            },
          ],
        },
        {
          delayDays: 3,
          variants: [
            FOLLOW_UP,
            { body: "Hi {{firstName}}, is this on your list this quarter?" },
          ],
        },
        {
          delayDays: 5,
          variants: [
            {
              body: "Hi {{firstName}, see https://example.com/pricing and https://example.com/demo before FRIDAY. This offer ENDS soon!!",
              subject:
                "Last chance: a free trial for {{company}}, with no obligation at all",
            },
          ],
        },
      ],
    },
    {
      id: "agencies",
      name: "Agency owners",
      steps: [{ variants: [OPENER] }, { delayDays: 3, variants: [FOLLOW_UP] }],
    },
  ],
  messages: [
    // 2026-11-09 is a Monday. Replies after 0.5, 6, 24, 48 and 96 hours.
    ...pair("lead1", "2026-11-09T09:00:00.000Z", "2026-11-09T09:30:00.000Z"),
    ...pair("lead2", "2026-11-09T09:00:00.000Z", "2026-11-09T15:00:00.000Z"),
    // The second message from lead3 is a follow-on, not a second reply time.
    ...pair(
      "lead3",
      "2026-11-10T09:00:00.000Z",
      "2026-11-11T09:00:00.000Z",
      "2026-11-11T10:00:00.000Z"
    ),
    ...pair("lead4", "2026-11-10T10:00:00.000Z", "2026-11-12T10:00:00.000Z"),
    ...pair("lead5", "2026-11-09T09:00:00.000Z", "2026-11-13T09:00:00.000Z"),
    // A reply with no send before it in what was read.
    {
      campaignId: "founders",
      direction: "in",
      id: "lead6_in0",
      leadId: "lead6",
      sentAt: "2026-11-12T15:00:00.000Z",
      threadId: "thread_lead6",
    },
  ],
  stats: [
    step("founders", 0, { replied: 60, sent: 1000 }),
    // How the vendor splits the first two steps of "SaaS founders" between their variants.
    { ...step("founders", 0, { replied: 40, sent: 500 }), variantKey: "A" },
    { ...step("founders", 0, { replied: 20, sent: 500 }), variantKey: "B" },
    step("founders", 1, { replied: 16, sent: 800 }),
    { ...step("founders", 1, { replied: 10, sent: 400 }), variantKey: "A" },
    { ...step("founders", 1, { replied: 6, sent: 400 }), variantKey: "B" },
    step("founders", 2, { replied: 1, sent: 600 }),
    step("agencies", 0, { replied: 12, sent: 600 }),
    step("agencies", 1, { replied: 9, sent: 450 }),
  ],
};
