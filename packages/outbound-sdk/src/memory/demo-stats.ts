// The demo's daily stats: three weeks for each campaign, written out day by
// day, with step and variant rows that add up to the campaign rows. Day 4
// before `now` carries a bounce spike, so anomalies has a day to flag.

import type { MemoryStats } from "./data.ts";

/**
 * One day of "Q4 SaaS founders", as sends and replies per step: step 0 runs
 * variants A and B, step 1 is the follow-up. Then positive replies, opens and
 * bounces for the whole campaign.
 */
type FoundersDay = readonly [
  aSent: number,
  aReplied: number,
  bSent: number,
  bReplied: number,
  followUpSent: number,
  followUpReplied: number,
  positive: number,
  opened: number,
  bounced: number,
];

/** One day of "Agency owners": its first step, its follow-up, then campaign counts. */
type AgenciesDay = readonly [
  firstSent: number,
  firstReplied: number,
  followUpSent: number,
  followUpReplied: number,
  positive: number,
  opened: number,
  bounced: number,
];

// Row 0 is the day before `now`, row 1 the day before that, and so on.
const FOUNDERS: readonly FoundersDay[] = [
  [15, 1, 15, 0, 14, 1, 1, 26, 1],
  [14, 1, 16, 1, 15, 0, 1, 24, 0],
  [16, 2, 14, 0, 15, 1, 2, 27, 1],
  // The bounce spike.
  [15, 1, 15, 0, 16, 0, 1, 22, 9],
  [15, 0, 15, 1, 14, 1, 1, 25, 0],
  [16, 1, 14, 0, 15, 0, 1, 26, 1],
  [14, 1, 16, 0, 15, 1, 1, 23, 0],
  [15, 2, 15, 1, 14, 0, 2, 25, 1],
  [16, 0, 15, 0, 15, 1, 0, 24, 0],
  [15, 1, 14, 0, 16, 1, 1, 26, 1],
  [14, 1, 15, 1, 15, 0, 1, 23, 0],
  [15, 1, 16, 0, 14, 1, 1, 25, 1],
  [16, 0, 15, 0, 15, 0, 0, 24, 0],
  [15, 1, 14, 1, 15, 1, 1, 26, 1],
  [14, 2, 15, 0, 16, 0, 1, 23, 0],
  [15, 1, 16, 0, 15, 1, 1, 25, 1],
  [16, 0, 14, 1, 14, 0, 0, 24, 0],
  [15, 1, 15, 0, 15, 1, 1, 26, 1],
  [14, 1, 16, 0, 16, 0, 1, 23, 0],
  [15, 1, 15, 0, 15, 1, 1, 25, 1],
  [16, 0, 14, 1, 14, 0, 0, 24, 0],
];

const AGENCIES: readonly AgenciesDay[] = [
  [30, 1, 20, 0, 0, 18, 3],
  [31, 0, 19, 0, 0, 17, 2],
  [29, 0, 21, 1, 0, 19, 3],
  [30, 1, 20, 0, 1, 18, 3],
  [31, 0, 19, 1, 0, 17, 2],
  [29, 1, 21, 0, 0, 19, 3],
  [30, 0, 20, 1, 1, 18, 2],
  [30, 1, 20, 0, 0, 17, 3],
  [31, 0, 19, 1, 0, 19, 2],
  [29, 1, 21, 0, 0, 18, 3],
  [30, 0, 20, 0, 0, 17, 2],
  [31, 0, 19, 1, 1, 19, 3],
  [29, 1, 21, 1, 1, 18, 2],
  [30, 0, 20, 0, 0, 17, 3],
  [31, 0, 19, 0, 0, 19, 2],
  [29, 1, 21, 0, 0, 18, 3],
  [30, 0, 20, 0, 0, 17, 2],
  [30, 0, 20, 0, 0, 19, 3],
  [31, 2, 19, 1, 1, 18, 2],
  [29, 0, 21, 0, 0, 17, 3],
  [30, 1, 20, 1, 0, 19, 2],
];

/** Sends and replies of one step, or one variant of it. */
interface StepCounts {
  readonly stepIndex: number;
  readonly variantKey: string;
  readonly sent: number;
  readonly replied: number;
}

interface Totals {
  readonly positive: number;
  readonly opened: number;
  readonly bounced: number;
}

const sumOf = (values: readonly number[]): number =>
  values.reduce((sum, value) => sum + value, 0);

/** A campaign's row for the day, and one row per step and variant under it. */
const rowsOf = (
  campaignId: string,
  date: string,
  steps: readonly StepCounts[],
  { bounced, opened, positive }: Totals
): MemoryStats[] => {
  const sent = sumOf(steps.map((step) => step.sent));

  return [
    {
      campaignId,
      counts: {
        bounced,
        // Step 0 is the first touch, so its sends are the leads contacted.
        contacted: sumOf(
          steps.flatMap((step) => (step.stepIndex === 0 ? [step.sent] : []))
        ),
        delivered: sent - bounced,
        opened,
        positive,
        replied: sumOf(steps.map((step) => step.replied)),
        sent,
      },
      date,
    },
    ...steps.map(({ replied, sent: stepSent, stepIndex, variantKey }) => ({
      campaignId,
      counts: { replied, sent: stepSent },
      date,
      stepIndex,
      variantKey,
    })),
  ];
};

const step = (
  stepIndex: number,
  variantKey: string,
  sent: number,
  replied: number
): StepCounts => ({ replied, sent, stepIndex, variantKey });

/** Every demo stats row, dated by `day(n)`: `n` days before `now`. */
export const demoStats = (day: (days: number) => string): MemoryStats[] => [
  ...FOUNDERS.flatMap(
    (
      [
        a,
        aReplied,
        b,
        bReplied,
        follow,
        followReplied,
        positive,
        opened,
        bounced,
      ],
      index
    ) =>
      rowsOf(
        "cmp_founders",
        day(index + 1),
        [
          step(0, "A", a, aReplied),
          step(0, "B", b, bReplied),
          step(1, "A", follow, followReplied),
        ],
        { bounced, opened, positive }
      )
  ),
  ...AGENCIES.flatMap(
    (
      [first, firstReplied, follow, followReplied, positive, opened, bounced],
      index
    ) =>
      rowsOf(
        "cmp_agencies",
        day(index + 1),
        [
          step(0, "A", first, firstReplied),
          step(1, "A", follow, followReplied),
        ],
        { bounced, opened, positive }
      )
  ),
];
