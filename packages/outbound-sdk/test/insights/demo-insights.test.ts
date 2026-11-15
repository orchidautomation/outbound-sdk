// Every insight finds something to say about demoData(), so a demo without a
// key never looks broken. The expected numbers are added up from the daily
// table in src/memory/demo-stats.ts.

import assert from "node:assert/strict";
import { test } from "node:test";

import { createOutbound } from "../../src/index.ts";
import {
  insights,
  listInsights,
  runInsightByName,
} from "../../src/insights/index.ts";
import { demoData, memory } from "../../src/memory/index.ts";

// The fixed clock the tests share, and the moment the site's samples run at.
const MOMENTS = [
  Date.parse("2026-10-08T12:00:00.000Z"),
  Date.parse("2026-11-14T00:00:00.000Z"),
];

const FOUNDERS = "memory:default:cmp_founders";

const instanceAt = (now: number) =>
  createOutbound({
    adapter: memory({ data: demoData({ now }) }),
    plugins: [insights()],
  });

/** The demo's value for each input an insight requires. */
const REQUIRED: Readonly<Record<string, string>> = {
  campaign: FOUNDERS,
  domain: "example.com",
  person: "person1@example.com",
};

/** `true` when the answer holds a number or a non-empty list anywhere in it. */
const hasContent = (value: unknown): boolean => {
  if (typeof value === "number") {
    return true;
  }

  if (Array.isArray(value)) {
    return value.length > 0;
  }

  return (
    typeof value === "object" &&
    value !== null &&
    Object.values(value).some(hasContent)
  );
};

const requiredOf = (parameters: unknown): readonly string[] => {
  const required =
    typeof parameters === "object" && parameters !== null
      ? (parameters as { readonly required?: unknown }).required
      : undefined;

  return Array.isArray(required) ? required.map(String) : [];
};

for (const now of MOMENTS) {
  const day = new Date(now).toISOString().slice(0, 10);

  test(`every insight has an answer on the demo data on ${day}`, async () => {
    const outbound = instanceAt(now);

    for (const listed of listInsights()) {
      const input = Object.fromEntries(
        requiredOf(listed.parameters).map((key) => {
          const value = REQUIRED[key];
          assert.ok(value !== undefined, `${listed.name} requires ${key}`);

          return [key, value];
        })
      );

      const answer = await runInsightByName(outbound, listed.name, input, {
        now,
      });

      assert.ok(hasContent(answer.data), `${listed.name} answered nothing`);
    }
  });

  test(`step_funnel reads every step of the demo campaign on ${day}`, async () => {
    const { data } = await instanceAt(now).insights.stepFunnel(
      { campaign: FOUNDERS },
      { now }
    );

    assert.deepEqual(
      data.steps.map((step) => [step.step, step.sent, step.replies]),
      [
        [0, 316 + 314, 19 + 7],
        [1, 313, 11],
      ]
    );

    assert.deepEqual(
      data.steps[0]?.variants.map((variant) => [
        variant.variantKey,
        variant.sent,
        variant.replies,
      ]),
      [
        ["A", 316, 19],
        ["B", 314, 7],
      ]
    );

    assert.equal(data.topStep, 0);
    assert.doesNotMatch(data.finding, /No step has stats/u);
  });

  test(`variant_test calls the demo's A/B test on ${day}`, async () => {
    const { data } = await instanceAt(now).insights.variantTest(
      { campaign: FOUNDERS },
      { now }
    );

    assert.equal(data.variantStatsReported, true);
    assert.equal(data.steps.length, 1);
    // 19 replies from 316 sends against 7 from 314.
    assert.equal(data.steps[0]?.leader, "A");
    assert.equal(data.steps[0]?.verdict, "winner");
  });

  test(`copy_reuse compares the shared follow-up on ${day}`, async () => {
    const { data } = await instanceAt(now).insights.copyReuse({}, { now });

    assert.equal(data.variantsWithoutStats, 0);
    // Variant A of step 0: 19 replies from 316 sends.
    assert.equal(data.bestCopy?.subject, "Quick question");
    assert.equal(data.bestCopy?.replies, 19);

    const [followUp] = data.reused;
    assert.equal(followUp?.subject, "Following up");
    // 11 of 313 in one campaign, 8 of 420 in the other.
    assert.equal(followUp?.sent, 313 + 420);
    assert.equal(followUp?.replies, 11 + 8);
  });

  test(`anomalies flags the demo's bounce spike and nothing else on ${day}`, async () => {
    const { data } = await instanceAt(now).insights.anomalies({}, { now });

    assert.ok(data.metrics.every((metric) => metric.testable));

    assert.deepEqual(
      data.anomalies.map((anomaly) => [
        anomaly.date,
        anomaly.metric,
        anomaly.value,
        anomaly.direction,
      ]),
      // 9 bounces in one campaign and 3 in the other, four days before now.
      [
        [
          new Date(now - 4 * 86_400_000).toISOString().slice(0, 10),
          "bounced",
          12,
          "above",
        ],
      ]
    );
  });
}
