import assert from "node:assert/strict";
import { test } from "node:test";

import { combine } from "../../src/combine/index.ts";
import { createOutbound, OutboundError } from "../../src/index.ts";
import { insights, runInsightByName } from "../../src/insights/index.ts";
import { memory } from "../../src/memory/index.ts";
import type { MemoryData } from "../../src/memory/index.ts";
import { must, ref, toolWithRows, withRows } from "./copy-helpers.ts";
import type { StepRow } from "./copy-helpers.ts";
import { NOW, single } from "./helpers.ts";

const DATA: MemoryData = { campaigns: [{ id: "c1" }, { id: "c2" }] };

const row = (
  step: number,
  variant: string,
  counts: StepRow["counts"]
): StepRow => ({ campaignId: "c1", counts, step, variant });

const ROWS: readonly StepRow[] = [
  // Step 0: a clear gap.
  row(0, "A", {
    delivered: 1000,
    opened: 250,
    positive: 20,
    replied: 60,
    sent: 1100,
  }),
  row(0, "B", {
    delivered: 1000,
    opened: 200,
    positive: 8,
    replied: 30,
    sent: 1100,
  }),
  // Step 1: a gap that could be chance.
  row(1, "A", { replied: 20, sent: 1000 }),
  row(1, "B", { replied: 30, sent: 1000 }),
  // Step 2: one variant has only 50 sends.
  row(2, "A", { replied: 5, sent: 50 }),
  row(2, "B", { replied: 40, sent: 400 }),
  // Step 3: one variant, nothing to test.
  row(3, "A", { replied: 9, sent: 900 }),
  // Step 4: C has the highest raw rate (3 / 40) on too few sends to count.
  row(4, "A", { replied: 50, sent: 1000 }),
  row(4, "B", { replied: 10, sent: 1000 }),
  row(4, "C", { replied: 3, sent: 40 }),
  // Step 5: nobody replied to either.
  row(5, "A", { replied: 0, sent: 200 }),
  row(5, "B", { replied: 0, sent: 200 }),
];

// Step 0 on replies would be divided by sends of 1100; use round numbers instead.
const REPLY_ROWS = ROWS.map((each) =>
  each.step === 0 ? { ...each, counts: { ...each.counts, sent: 1000 } } : each
);

test("variant_test names a winner only when the gap is more than chance", async () => {
  const result = await withRows(DATA, REPLY_ROWS).insights.variantTest(
    { campaign: ref("c1") },
    { now: NOW }
  );

  assert.equal(result.insight, "variant_test");
  assert.equal(result.data.metric, "replied");
  assert.equal(result.data.variantStatsReported, true);

  // Winners first, then no difference yet, then too little data; by step within each.
  assert.deepEqual(
    result.data.steps.map((step) => [
      step.step,
      step.verdict,
      step.leader,
      step.pValue,
      step.moreSendsNeeded,
    ]),
    [
      // 60/1000 against 30/1000: pooled 0.045, z = 3.2359, p = 0.0012.
      [0, "winner", "A", 0.0012, null],
      // 50/1000 against 10/1000: z = 5.2432, p rounds to 0.
      [4, "winner", "A", 0, null],
      // 30/1000 against 20/1000: z = 1.4322, p = 0.1521. The sample must grow
      // by (1.9604 / 1.4322)^2 = 1.8737, so 0.8737 * 2000 = 1748 more sends.
      [1, "no_difference_yet", "B", 0.1521, 1748],
      // Both at 0: the test has nothing to measure.
      [5, "no_difference_yet", "A", null, null],
      // A is 50 short of the 100 needed.
      [2, "too_little_data", null, null, 50],
    ]
  );
  assert.deepEqual(result.data.totals, {
    noDifferenceYet: 2,
    stepsTested: 5,
    tooLittleData: 1,
    winners: 2,
  });

  const [first, second, third] = result.data.steps;

  assert.deepEqual(first?.variants, [
    {
      basis: "sent",
      count: 60,
      enoughData: true,
      interval: { high: 0.0765, low: 0.0469 },
      pValueVsLeader: null,
      rate: 0.06,
      sent: 1000,
      trials: 1000,
      variantKey: "A",
    },
    {
      basis: "sent",
      count: 30,
      enoughData: true,
      interval: { high: 0.0425, low: 0.0211 },
      pValueVsLeader: 0.0012,
      rate: 0.03,
      sent: 1000,
      trials: 1000,
      variantKey: "B",
    },
  ]);
  assert.equal(
    first?.reason,
    "Variant A (0.06) beats every other variant by more than chance at alpha 0.05."
  );

  // C's 0.075 is the highest raw rate, but 40 sends are not compared.
  assert.deepEqual(
    second?.variants.map((each) => [
      each.variantKey,
      each.rate,
      each.enoughData,
      each.pValueVsLeader,
    ]),
    [
      ["A", 0.05, true, null],
      ["B", 0.01, true, 0],
      ["C", 0.075, false, null],
    ]
  );
  assert.match(second?.reason ?? "", /1 variant\(s\) with too little data/u);
  assert.equal(
    third?.reason,
    "Variant B (0.03) leads variant A (0.02), but a gap this size could be chance."
  );
});

test("variant_test changes its verdict with alpha and min_sent", async () => {
  const outbound = withRows(DATA, REPLY_ROWS);

  // p = 0.1521 is under an alpha of 0.2.
  const loose = await outbound.insights.variantTest(
    { alpha: 0.2, campaign: ref("c1") },
    { now: NOW }
  );

  assert.equal(
    loose.data.steps.find((step) => step.step === 1)?.verdict,
    "winner"
  );
  assert.equal(loose.data.alpha, 0.2);

  // With a bar of 40 sends step 2 is compared: 5/50 and 40/400 are both 0.1.
  const small = await outbound.insights.variantTest(
    { campaign: ref("c1"), min_sent: 40 },
    { now: NOW }
  );

  const tied = small.data.steps.find((step) => step.step === 2);

  assert.deepEqual(
    [tied?.verdict, tied?.leader, tied?.pValue, tied?.moreSendsNeeded],
    // The tie goes to the variant with more sends; a gap of nothing never becomes a winner.
    ["no_difference_yet", "B", 1, null]
  );

  // The bar also lets C into step 4, where it leads on 3 of 40.
  const stepFour = small.data.steps.find((step) => step.step === 4);

  assert.equal(stepFour?.leader, "C");
  assert.equal(stepFour?.verdict, "no_difference_yet");
});

test("variant_test judges on positive replies, opens or clicks, and keeps an unreported count unknown", async () => {
  const outbound = withRows(DATA, ROWS);

  const stepZero = async (input: {
    readonly metric: "clicked" | "opened" | "positive";
    readonly alpha?: number;
  }) => {
    const result = await outbound.insights.variantTest(
      { campaign: ref("c1"), ...input },
      { now: NOW }
    );

    return must(result.data.steps.find((step) => step.step === 0));
  };

  // Positive replies are divided by sends when leads are not counted: 20 and 8 of 1100.
  const positive = await stepZero({ metric: "positive" });

  assert.deepEqual(
    [positive.verdict, positive.leader, positive.variants[0]?.trials],
    ["winner", "A", 1100]
  );

  // Opens are divided by delivered: 250/1000 against 200/1000, z = 2.6774, p = 0.0074.
  const opened = await stepZero({ metric: "opened" });

  assert.deepEqual(
    [
      opened.verdict,
      opened.pValue,
      opened.variants[0]?.basis,
      opened.variants[0]?.rate,
      opened.variants[1]?.rate,
    ],
    ["winner", 0.0074, "delivered", 0.25, 0.2]
  );

  // At alpha 0.005 the critical z is 2.8074: (2.8074 / 2.6774)^2 - 1 = 0.0995, times 2000 = 199.
  const strict = await stepZero({ alpha: 0.005, metric: "opened" });

  assert.deepEqual(
    [strict.verdict, strict.moreSendsNeeded],
    ["no_difference_yet", 199]
  );

  // No click counts: unknown, not zero, and more sends would not help.
  const clicked = await stepZero({ metric: "clicked" });

  assert.deepEqual(
    [
      clicked.verdict,
      clicked.leader,
      clicked.moreSendsNeeded,
      clicked.variants[0]?.count,
      clicked.variants[0]?.rate,
      clicked.variants[0]?.interval,
      clicked.variants[0]?.enoughData,
    ],
    ["too_little_data", null, null, null, null, null, false]
  );
  assert.match(clicked.reason, /does not report clicked/u);
});

test("variant_test returns nothing to test when the stats carry no variants, or there are no stats", async () => {
  const stepOnly = await single({
    campaigns: [{ id: "c1" }],
    stats: [
      {
        campaignId: "c1",
        counts: { replied: 5, sent: 100 },
        date: "2026-11-01",
        stepIndex: 0,
      },
    ],
  }).insights.variantTest({ campaign: ref("c1") }, { now: NOW });

  assert.deepEqual(stepOnly.data.steps, []);
  assert.equal(stepOnly.data.variantStatsReported, false);
  assert.deepEqual(stepOnly.meta.notes, [
    "The step stats carry no variant rows, so there is nothing to compare.",
  ]);

  const none = await withRows(DATA, ROWS).insights.variantTest(
    { campaign: ref("c2") },
    { now: NOW }
  );

  assert.deepEqual(none.data.steps, []);
  assert.deepEqual(none.data.totals, {
    noDifferenceYet: 0,
    stepsTested: 0,
    tooLittleData: 0,
    winners: 0,
  });
});

test("variant_test is refused without step stats and rejects an unknown metric", async () => {
  await assert.rejects(
    single(DATA, { "stats.byStep": false }).insights.variantTest(
      { campaign: ref("c1") },
      { now: NOW }
    ),
    (error) =>
      error instanceof OutboundError &&
      error.code === "Unsupported" &&
      error.message.includes("stats.byStep")
  );

  // By name, as an agent calls it: the metric is not one of the four.
  await assert.rejects(
    async () =>
      await runInsightByName(withRows(DATA, ROWS), "variant_test", {
        campaign: ref("c1"),
        metric: "bounced",
      }),
    (error) => error instanceof OutboundError && error.code === "Invalid"
  );
});

test("variant_test reads the campaign's tool on a combined instance", async () => {
  const outbound = createOutbound({
    adapter: combine([
      toolWithRows(DATA, REPLY_ROWS, "mailtool"),
      memory({
        data: { campaigns: [{ channel: "linkedin", id: "c1" }] },
        name: "lntool",
        workspaceId: "agency",
      }),
    ]),
    plugins: [insights()],
  });

  const email = await outbound.insights.variantTest(
    { campaign: ref("c1", "mailtool") },
    { now: NOW }
  );

  assert.equal(email.data.totals.winners, 2);
  assert.equal(email.meta.provider, outbound.provider);

  const linkedin = await outbound.insights.variantTest(
    { campaign: ref("c1", "lntool") },
    { now: NOW }
  );

  assert.equal(linkedin.data.variantStatsReported, false);
});
