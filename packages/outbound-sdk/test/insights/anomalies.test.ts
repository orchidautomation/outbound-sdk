import assert from "node:assert/strict";
import { test } from "node:test";

import type { MemoryData } from "../../src/memory/index.ts";
import { NOW, single } from "./helpers.ts";
import { pair, row, unsupported } from "./ops-helpers.ts";

// NOW is 2026-11-14. With days 5 the days checked are 11-09 to 11-13, and
// with baseline_days 7 each is held to the 7 days before it.
const SENT = [
  ["2026-11-02", 100, 1],
  ["2026-11-03", 102, 2],
  ["2026-11-04", 98, 1],
  ["2026-11-05", 100, 2],
  ["2026-11-06", 104, 1],
  ["2026-11-07", 96, 2],
  ["2026-11-08", 100, 1],
  ["2026-11-09", 101, 2],
  // The outage.
  ["2026-11-10", 50, 1],
  ["2026-11-11", 100, 2],
  // 11-12 has no row: no data, not zero sends.
  ["2026-11-13", 99, 30],
] as const;

const DATA: MemoryData = {
  campaigns: [{ id: "c1" }, { id: "c2" }],
  stats: [
    // Replies never move, so their baseline has no spread. Bounces are not reported.
    ...SENT.map(([date, sent, positive]) =>
      row("c1", date, { positive, replied: 5, sent })
    ),
    row("c2", "2026-11-10", { sent: 50 }),
    // Today is not over and is not checked.
    row("c1", "2026-11-14", { sent: 1 }),
  ],
};

const INPUT = {
  baseline_days: 7,
  campaign: "memory:agency:c1",
  days: 5,
  metrics: ["sent", "positive", "replied", "bounced"],
} as const;

test("anomalies returns the days that broke from their baseline, newest first, and says what could not be tested", async () => {
  const result = await single(DATA).insights.anomalies(
    { ...INPUT, metrics: [...INPUT.metrics] },
    { now: NOW }
  );

  assert.equal(result.insight, "anomalies");
  assert.equal(result.data.scope, "memory:agency:c1");
  assert.deepEqual(result.data.period, {
    from: "2026-11-09",
    to: "2026-11-13",
  });
  assert.equal(result.data.threshold, 2.5);
  assert.deepEqual(result.data.anomalies, [
    {
      // Baseline 11-06 to 11-11 (11-12 has no data): 1, 2, 1, 2, 1, 2. Mean 1.5,
      // deviation sqrt(6 x 0.25 / 5) = 0.5477; z = 28.5 / 0.5477 = 52.03.
      baselineMean: 1.5,
      baselinePoints: 6,
      date: "2026-11-13",
      direction: "above",
      finding:
        "positive was 30 on 2026-11-13, against an average of 1.5 over the 6 days with data before it (z = 52.0336).",
      metric: "positive",
      value: 30,
      zScore: 52.0336,
    },
    {
      // Baseline 11-03 to 11-09: 102, 98, 100, 104, 96, 100, 101. Mean 100.1429,
      // deviation sqrt(40.857 / 6) = 2.6095; z = -50.1429 / 2.6095 = -19.22.
      baselineMean: 100.1429,
      baselinePoints: 7,
      date: "2026-11-10",
      direction: "below",
      finding:
        "sent was 50 on 2026-11-10, against an average of 100.1429 over the 7 days with data before it (z = -19.2155).",
      metric: "sent",
      value: 50,
      zScore: -19.2155,
    },
  ]);
  assert.deepEqual(result.data.metrics, [
    {
      daysTested: 4,
      daysWithData: 4,
      metric: "sent",
      reason: null,
      testable: true,
    },
    {
      daysTested: 4,
      daysWithData: 4,
      metric: "positive",
      reason: null,
      testable: true,
    },
    {
      daysTested: 0,
      daysWithData: 4,
      metric: "replied",
      reason:
        "The baseline has no spread: its days all have the same count, so nothing can be called unusual.",
      testable: false,
    },
    {
      daysTested: 0,
      daysWithData: 0,
      metric: "bounced",
      reason: "The vendor reports no bounced count for these days.",
      testable: false,
    },
  ]);
  assert.equal(result.meta.complete, true);
});

test("anomalies follows the threshold, the baseline length and the days checked", async () => {
  const outbound = single(DATA);
  const sent = { ...INPUT, metrics: ["sent" as const] };

  const high = await outbound.insights.anomalies(
    { ...sent, threshold: 20 },
    { now: NOW }
  );

  assert.deepEqual(high.data.anomalies, []);
  assert.equal(high.data.metrics[0]?.daysTested, 4);

  // The default metrics are sent, replied and bounced.
  const defaults = await outbound.insights.anomalies(
    { baseline_days: 7, campaign: INPUT.campaign, days: 5 },
    { now: NOW }
  );

  assert.deepEqual(
    defaults.data.metrics.map((each) => each.metric),
    ["sent", "replied", "bounced"]
  );
  assert.deepEqual(
    defaults.data.anomalies.map((each) => [each.metric, each.date]),
    [["sent", "2026-11-10"]]
  );

  // No day has 8 earlier days of data inside a 7-day baseline.
  const demanding = await outbound.insights.anomalies(
    { ...sent, min_baseline_points: 8 },
    { now: NOW }
  );

  assert.deepEqual(demanding.data.anomalies, []);
  assert.deepEqual(demanding.data.metrics, [
    {
      daysTested: 0,
      daysWithData: 4,
      metric: "sent",
      reason: "Too few earlier days with data to form a baseline.",
      testable: false,
    },
  ]);

  // Three days checked: 11-11 to 11-13, so the outage on 11-10 is only a baseline day.
  const short = await outbound.insights.anomalies(
    { ...sent, days: 3 },
    { now: NOW }
  );

  assert.deepEqual(short.data.period, { from: "2026-11-11", to: "2026-11-13" });
  assert.deepEqual(short.data.anomalies, []);
  assert.equal(short.data.metrics[0]?.daysWithData, 2);
});

test("anomalies adds campaigns together for the workspace, so one campaign's dip can vanish", async () => {
  const result = await single(DATA).insights.anomalies(
    { baseline_days: 7, days: 5, metrics: ["sent"] },
    { now: NOW }
  );

  assert.equal(result.data.scope, "workspace");
  // c2 sent 50 on 11-10, so the workspace sent 100 that day: nothing unusual.
  assert.deepEqual(result.data.anomalies, []);
});

test("anomalies has nothing to test without data, and is refused without stats by day or the scope's stats", async () => {
  const empty = await single({ campaigns: [{ id: "c1" }] }).insights.anomalies(
    { campaign: "memory:agency:c1" },
    { now: NOW }
  );

  assert.deepEqual(empty.data.anomalies, []);
  assert.deepEqual(
    empty.data.metrics.map((each) => [each.metric, each.testable, each.reason]),
    [
      ["sent", false, "The vendor reports no sent count for these days."],
      ["replied", false, "The vendor reports no replied count for these days."],
      ["bounced", false, "The vendor reports no bounced count for these days."],
    ]
  );
  // 30 days checked, ending yesterday.
  assert.deepEqual(empty.data.period, { from: "2026-10-15", to: "2026-11-13" });

  await assert.rejects(
    async () =>
      await single(DATA, { "stats.byDay": false }).insights.anomalies({}),
    unsupported("stats.byDay")
  );
  await assert.rejects(
    async () =>
      await single(DATA, { "stats.workspace": false }).insights.anomalies({}),
    unsupported("stats.workspace")
  );
});

test("anomalies adds the tools of a combined instance together day by day", async () => {
  const outbound = pair(DATA, {
    campaigns: [{ channel: "linkedin", id: "k1" }],
    stats: [row("k1", "2026-11-09", { sent: 29 })],
  });

  const workspace = await outbound.insights.anomalies(
    { baseline_days: 7, days: 5, metrics: ["sent"] },
    { now: NOW }
  );

  // 11-09: 101 by email plus 29 on LinkedIn = 130, against a baseline of
  // 100, 102, 98, 100, 104, 96, 100: mean 100, deviation sqrt(40 / 6) = 2.582.
  assert.deepEqual(
    workspace.data.anomalies.map((each) => [
      each.date,
      each.value,
      each.baselineMean,
      each.zScore,
      each.direction,
    ]),
    [["2026-11-09", 130, 100, 11.619, "above"]]
  );

  const campaign = await outbound.insights.anomalies(
    { ...INPUT, campaign: "mailtool:agency:c1", metrics: ["sent"] },
    { now: NOW }
  );

  assert.deepEqual(
    campaign.data.anomalies.map((each) => each.date),
    ["2026-11-10"]
  );
});
