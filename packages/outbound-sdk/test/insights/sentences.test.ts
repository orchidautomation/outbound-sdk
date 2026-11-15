// The sentences an insight returns (findings, actions, reasons) go straight
// into a report or a chat message, so their numbers are written the way a
// person would: at most one decimal, and rates as percentages. The answer's
// own number fields keep full precision. Only p-values and the significance
// level keep their decimals.

import assert from "node:assert/strict";
import { test } from "node:test";

import { createOutbound } from "../../src/index.ts";
import type { Json } from "../../src/index.ts";
import { listInsights, runInsightByName } from "../../src/insights/index.ts";
import { demoData, memory } from "../../src/memory/index.ts";

const NOW = Date.parse("2026-11-14T12:00:00.000Z");
const CAMPAIGN = "memory:default:cmp_founders";

// Inputs for the insights that require one.
const REQUIRED: Readonly<Record<string, Json>> = {
  accountSummary: { domain: "example.com" },
  campaignDiagnosis: { campaign: CAMPAIGN },
  copyAudit: { campaign: CAMPAIGN },
  personSummary: { person: "person1@example.com" },
  personalizationGaps: { campaign: CAMPAIGN },
  pipelineForecast: { campaign: CAMPAIGN },
  stepFunnel: { campaign: CAMPAIGN },
  variantTest: { campaign: CAMPAIGN },
};

const LONG_DECIMAL = /\d\.\d{2,}/u;

// A p-value or the significance level it is compared with.
const P_VALUE = /\b(?:p [=<]|alpha) \d+\.\d+/gu;

const sentences = (value: Json, found: string[] = []): string[] => {
  if (typeof value === "string" && value.includes(" ")) {
    found.push(value);
  } else if (Array.isArray(value)) {
    for (const item of value) {
      sentences(item, found);
    }
  } else if (value !== null && typeof value === "object") {
    for (const item of Object.values(value)) {
      sentences(item, found);
    }
  }

  return found;
};

test("no insight writes a number with more than one decimal in a sentence", async () => {
  const outbound = createOutbound({
    adapter: memory({ data: demoData({ now: NOW }) }),
  });

  let checked = 0;

  for (const { key } of listInsights()) {
    // oxlint-disable-next-line no-await-in-loop -- one insight at a time keeps a failure easy to read.
    const result = await runInsightByName(outbound, key, REQUIRED[key] ?? {}, {
      now: NOW,
    });

    for (const sentence of sentences(result.data)) {
      checked += 1;

      assert.doesNotMatch(
        sentence.replaceAll(P_VALUE, "p"),
        LONG_DECIMAL,
        `${key}: ${sentence}`
      );
    }
  }

  // The demo data does produce sentences with averages, rates and day counts.
  assert.ok(checked > 20, `only ${checked} sentences were checked`);
});

test("the numbers behind a sentence keep their precision", async () => {
  const outbound = createOutbound({
    adapter: memory({ data: demoData({ now: NOW }) }),
  });

  const report = await runInsightByName(
    outbound,
    "clientReport",
    {},
    {
      now: NOW,
    }
  );

  const { actions } = report.data as {
    actions: { action: string; number: number | null }[];
  };

  const runway = actions.find((each) => each.action.startsWith("Add leads"));

  assert.equal(
    runway?.action,
    "Add leads to Q4 SaaS founders: 1 lead remains, about 0.1 days of sending."
  );
  assert.equal(runway?.number, 0.0778);
});
