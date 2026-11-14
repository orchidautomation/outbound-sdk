// One made-up email campaign, "SaaS founders", that tests two versions of
// each of its three steps.
import type { MemoryData, MemoryStats } from "outbound-sdk/memory";

export const CAMPAIGN = "cmp_founders";

interface VariantCounts {
  readonly step: number;
  readonly variantKey: string;
  readonly contacted: number;
  readonly sent: number;
  readonly replied: number;
}

// What a vendor that splits step stats by variant would report.
const VARIANTS: readonly VariantCounts[] = [
  // Step 0: A is well ahead.
  { contacted: 800, replied: 48, sent: 800, step: 0, variantKey: "A" },
  { contacted: 800, replied: 24, sent: 800, step: 0, variantKey: "B" },
  // Step 1: B is ahead, by a gap that chance alone could produce.
  { contacted: 700, replied: 20, sent: 700, step: 1, variantKey: "A" },
  { contacted: 700, replied: 28, sent: 700, step: 1, variantKey: "B" },
  // Step 2: A has only reached 60 leads.
  { contacted: 60, replied: 3, sent: 60, step: 2, variantKey: "A" },
  { contacted: 400, replied: 5, sent: 400, step: 2, variantKey: "B" },
];

/** One stats row per variant, as the in-memory adapter's seed takes it. */
const toStats = (variant: VariantCounts): MemoryStats => ({
  campaignId: CAMPAIGN,
  counts: {
    contacted: variant.contacted,
    replied: variant.replied,
    sent: variant.sent,
  },
  date: "2026-11-13",
  stepIndex: variant.step,
  variantKey: variant.variantKey,
});

export const seed: MemoryData = {
  campaigns: [
    {
      id: CAMPAIGN,
      name: "SaaS founders",
      steps: [
        {
          variants: [
            {
              body: "Hi {{firstName}}, a question.",
              subject: "Quick question",
            },
            { body: "Hi {{firstName}}, an idea.", subject: "An idea for you" },
          ],
        },
        {
          delayDays: 3,
          variants: [
            { body: "Did you see my note?", subject: "Quick question" },
            { body: "One more thought.", subject: "Quick question" },
          ],
        },
        {
          delayDays: 5,
          variants: [
            { body: "Should I close the file?", subject: "Quick question" },
            { body: "Last note from me.", subject: "Quick question" },
          ],
        },
      ],
    },
  ],
  stats: VARIANTS.map(toStats),
};

/**
 * The same campaign as a vendor that does not split step stats by variant
 * reports it: no row names a variant, so each step is one total.
 */
export const unsplitSeed: MemoryData = {
  ...seed,
  stats: VARIANTS.map((variant) => {
    const { variantKey: _variantKey, ...row } = toStats(variant);

    return row;
  }),
};
