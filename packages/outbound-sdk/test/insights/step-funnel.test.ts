import assert from "node:assert/strict";
import { test } from "node:test";

import { combine } from "../../src/combine/index.ts";
import { createOutbound, OutboundError } from "../../src/index.ts";
import { insights } from "../../src/insights/index.ts";
import { memory } from "../../src/memory/index.ts";
import type { MemoryData } from "../../src/memory/index.ts";
import { ref, withRows } from "./copy-helpers.ts";
import { NOW, single } from "./helpers.ts";

const variant = [{ body: "Hello", subject: "Quick question" }];

const FUNNEL: MemoryData = {
  campaigns: [
    {
      id: "c1",
      steps: [
        { delayDays: 0, variants: variant },
        { delayDays: 3, variants: variant },
        { delayDays: 4, variants: variant },
        // No stats: the step has not sent yet.
        { delayDays: 7, variants: variant },
      ],
    },
    { id: "empty" },
  ],
  stats: [
    {
      campaignId: "c1",
      counts: { replied: 20, sent: 600 },
      date: "2026-11-01",
      stepIndex: 0,
    },
    {
      campaignId: "c1",
      counts: { replied: 10, sent: 400 },
      date: "2026-11-05",
      stepIndex: 0,
    },
    {
      campaignId: "c1",
      counts: { replied: 12, sent: 800 },
      date: "2026-11-05",
      stepIndex: 1,
    },
    {
      campaignId: "c1",
      counts: { replied: 0, sent: 500 },
      date: "2026-11-08",
      stepIndex: 2,
    },
  ],
};

test("step_funnel reports each step's sends, replies, rate, share and the drop from the step before", async () => {
  const result = await single(FUNNEL).insights.stepFunnel(
    { campaign: ref("c1") },
    { now: NOW }
  );

  assert.equal(result.insight, "step_funnel");
  assert.equal(result.meta.complete, true);
  assert.deepEqual(
    result.data.steps.map((step) => [
      step.step,
      step.action,
      step.delayDays,
      step.sent,
      step.replies,
      step.replyRate,
      step.shareOfReplies,
      step.sentDrop,
      step.sentDropRate,
      step.earnsPlace,
    ]),
    [
      // 30 / 1000 = 0.03; 30 of all 42 replies = 0.7143.
      [0, "email", 0, 1000, 30, 0.03, 0.7143, null, null, true],
      // 12 / 800 = 0.015; 12 / 42 = 0.2857; 1000 - 800 = 200, 200 / 1000.
      [1, "email", 3, 800, 12, 0.015, 0.2857, 200, 0.2, true],
      // 800 - 500 = 300, 300 / 800 = 0.375. No reply: the interval starts at 0.
      [2, "email", 4, 500, 0, 0, 0, 300, 0.375, false],
      [3, "email", 7, null, null, null, null, null, null, null],
    ]
  );

  // Wilson at 95%: 30 of 1000 is 0.0211 to 0.0425, 12 of 800 is 0.0086 to 0.026.
  assert.deepEqual(result.data.steps[0]?.replyRateInterval, {
    high: 0.0425,
    low: 0.0211,
  });
  assert.deepEqual(result.data.steps[1]?.replyRateInterval, {
    high: 0.026,
    low: 0.0086,
  });
  assert.deepEqual(result.data.steps[2]?.replyRateInterval, {
    high: 0.0076,
    low: 0,
  });
  assert.equal(result.data.steps[3]?.replyRateInterval, null);
  assert.equal(result.data.steps[0]?.replyRateBasis, "sent");
  assert.equal(result.data.steps[3]?.replyRateBasis, null);
  assert.deepEqual(result.data.steps[0]?.variants, []);

  assert.equal(result.data.topStep, 0);
  assert.equal(result.data.lastStepEarningPlace, 1);
  assert.deepEqual(result.data.totals, { replies: 42, sent: 2300 });
  assert.deepEqual(result.data.unattributed, {
    replies: null,
    rows: 0,
    sent: null,
  });
  assert.equal(
    result.data.finding,
    "Step 1 brings the most replies: 30 of 42. Step 2 is the last whose reply rate is reliably above the bar; the 1 later step sent 500 messages for 0 replies."
  );
});

test("step_funnel raises the bar with min_reply_rate and narrows the days with from and to", async () => {
  const outbound = single(FUNNEL);

  // Step 1's interval starts at 0.0086, under a bar of 0.01; step 0's starts at 0.0211.
  const strict = await outbound.insights.stepFunnel(
    { campaign: ref("c1"), min_reply_rate: 0.01 },
    { now: NOW }
  );

  assert.equal(strict.data.lastStepEarningPlace, 0);
  assert.deepEqual(
    strict.data.steps.map((step) => step.earnsPlace),
    [true, false, false, null]
  );

  const firstDays = await outbound.insights.stepFunnel(
    { campaign: ref("c1"), from: "2026-11-01", to: "2026-11-02" },
    { now: NOW }
  );

  assert.deepEqual(
    firstDays.data.steps.map((step) => [step.sent, step.replies]),
    [
      [600, 20],
      [null, null],
      [null, null],
      [null, null],
    ]
  );
  assert.equal(firstDays.data.steps[0]?.shareOfReplies, 1);
  assert.equal(firstDays.data.lastStepEarningPlace, 0);
  assert.match(firstDays.data.finding, /Every step up to step 1 /u);
});

test("step_funnel splits a step by variant, keeps counts tied to no step apart, and lists a step the sequence no longer has", async () => {
  const data: MemoryData = {
    campaigns: [
      {
        id: "c1",
        steps: [
          {
            variants: [
              { body: "First body", subject: "One" },
              { body: "Second body", subject: "Two" },
            ],
          },
          { variants: variant },
        ],
      },
    ],
  };

  const outbound = withRows(data, [
    {
      campaignId: "c1",
      counts: { replied: 20, sent: 500 },
      step: 0,
      variant: "A",
    },
    {
      campaignId: "c1",
      counts: { replied: 10, sent: 500 },
      step: 0,
      variant: "B",
    },
    // Unique leads are the base when the vendor counts them: 6 / 300 = 0.02.
    {
      campaignId: "c1",
      counts: { contacted: 300, replied: 6, sent: 700 },
      step: 1,
    },
    { campaignId: "c1", counts: { replied: 1, sent: 90 }, step: 4 },
    { campaignId: "c1", counts: { replied: 3, sent: 40 }, step: null },
  ]);

  const result = await outbound.insights.stepFunnel(
    { campaign: ref("c1") },
    { now: NOW }
  );

  const [first, second, gone] = result.data.steps;

  const hashes = (
    await outbound.campaign(ref("c1")).sequence()
  ).steps[0]?.variants.map((each) => each.contentHash);

  // The step's total is its variants added up: 500 + 500 sends, 20 + 10 replies.
  assert.deepEqual(
    [first?.sent, first?.replies, first?.replyRate],
    [1000, 30, 0.03]
  );
  assert.deepEqual(first?.variants, [
    {
      contentHash: hashes?.[0],
      replies: 20,
      replyRate: 0.04,
      replyRateInterval: { high: 0.061, low: 0.026 },
      sent: 500,
      variantKey: "A",
    },
    {
      contentHash: hashes?.[1],
      replies: 10,
      replyRate: 0.02,
      replyRateInterval: { high: 0.0364, low: 0.0109 },
      sent: 500,
      variantKey: "B",
    },
  ]);

  assert.deepEqual(
    [second?.sent, second?.replies, second?.replyRate, second?.replyRateBasis],
    [700, 6, 0.02, "contacted"]
  );

  // Step 4 is in the stats only. Its drop is from the row above: 700 - 90.
  assert.deepEqual(
    [gone?.step, gone?.action, gone?.inSequence, gone?.sent, gone?.sentDrop],
    [4, null, false, 90, 610]
  );

  // 30 + 6 + 1 attributed and 3 unattributed replies: shares are of all 40.
  assert.deepEqual(result.data.unattributed, { replies: 3, rows: 1, sent: 40 });
  assert.deepEqual(result.data.totals, { replies: 40, sent: 1830 });
  assert.equal(first?.shareOfReplies, 0.75);
  assert.equal(second?.shareOfReplies, 0.15);
  assert.ok(result.meta.notes.some((note) => note.includes("tied to no step")));
});

test("step_funnel keeps an unknown reply count unknown", async () => {
  const result = await single({
    campaigns: [{ id: "c1", steps: [{ variants: variant }] }],
    stats: [
      {
        campaignId: "c1",
        counts: { sent: 250 },
        date: "2026-11-01",
        stepIndex: 0,
      },
    ],
  }).insights.stepFunnel({ campaign: ref("c1") }, { now: NOW });

  const [step] = result.data.steps;

  assert.deepEqual(
    [
      step?.sent,
      step?.replies,
      step?.replyRate,
      step?.replyRateInterval,
      step?.shareOfReplies,
      step?.earnsPlace,
    ],
    [250, null, null, null, null, null]
  );
  assert.equal(result.data.topStep, null);
  assert.equal(result.data.lastStepEarningPlace, null);
  assert.deepEqual(result.data.totals, { replies: null, sent: 250 });
  assert.equal(result.data.finding, "No step has a reply in this range.");
});

test("step_funnel on a campaign with no steps and no stats returns an empty funnel", async () => {
  const result = await single(FUNNEL).insights.stepFunnel(
    { campaign: ref("empty") },
    { now: NOW }
  );

  assert.deepEqual(result.data.steps, []);
  assert.equal(result.data.topStep, null);
  assert.equal(result.data.lastStepEarningPlace, null);
  assert.deepEqual(result.data.totals, { replies: null, sent: null });
  assert.equal(
    result.data.finding,
    "No step has stats yet, so there is nothing to compare."
  );
});

test("step_funnel says when replies exist but no step clears the bar", async () => {
  const result = await single(FUNNEL).insights.stepFunnel(
    { campaign: ref("c1"), min_reply_rate: 0.5 },
    { now: NOW }
  );

  assert.equal(result.data.lastStepEarningPlace, null);
  assert.match(result.data.finding, /No step's reply rate is reliably above/u);
});

test("step_funnel is refused without the sequence or the step stats, and rejects a bad day", async () => {
  for (const key of ["sequence", "stats.byStep"]) {
    await assert.rejects(
      single(FUNNEL, { [key]: false }).insights.stepFunnel(
        { campaign: ref("c1") },
        { now: NOW }
      ),
      (error) =>
        error instanceof OutboundError &&
        error.code === "Unsupported" &&
        error.message.includes(key)
    );
  }

  await assert.rejects(
    single(FUNNEL).insights.stepFunnel(
      { campaign: ref("c1"), from: "last week" },
      { now: NOW }
    ),
    (error) => error instanceof OutboundError && error.code === "Invalid"
  );
});

test("step_funnel reads a campaign by its ref on a combined instance", async () => {
  const outbound = createOutbound({
    adapter: combine([
      memory({ data: FUNNEL, name: "mailtool", workspaceId: "agency" }),
      memory({
        data: {
          campaigns: [
            {
              channel: "linkedin",
              id: "c1",
              steps: [
                { action: "connection_request", variants: [{ body: "Hi" }] },
              ],
            },
          ],
          stats: [
            {
              campaignId: "c1",
              counts: { replied: 9, sent: 300 },
              date: "2026-11-02",
              stepIndex: 0,
            },
          ],
        },
        name: "lntool",
        workspaceId: "agency",
      }),
    ]),
    plugins: [insights()],
  });

  const linkedin = await outbound.insights.stepFunnel(
    { campaign: "lntool:agency:c1" },
    { now: NOW }
  );

  // Same source id in both tools; the ref picks the LinkedIn one. 9 / 300 = 0.03.
  assert.deepEqual(
    linkedin.data.steps.map((step) => [
      step.action,
      step.sent,
      step.replies,
      step.replyRate,
    ]),
    [["connection_request", 300, 9, 0.03]]
  );

  const email = await outbound.insights.stepFunnel(
    { campaign: "mailtool:agency:c1" },
    { now: NOW }
  );

  assert.equal(email.data.totals.sent, 2300);
});
