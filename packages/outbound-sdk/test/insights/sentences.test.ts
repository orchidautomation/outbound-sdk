// The sentences an insight returns (findings, actions, reasons) go straight
// into a report or a chat message, so their numbers are written the way a
// person would: at most one decimal, and rates as percentages. The answer's
// own number fields keep full precision. Only p-values and the significance
// level keep their decimals.

import assert from "node:assert/strict";
import { test } from "node:test";

import { cardFor } from "../../src/cards/index.ts";
import type { CardSpec } from "../../src/cards/index.ts";
import { identity } from "../../src/identity/index.ts";
import { createOutbound, MemoryRateLimitStore } from "../../src/index.ts";
import type { Json, Outbound } from "../../src/index.ts";
import {
  insights,
  insightTools,
  listInsights,
  runInsightByName,
} from "../../src/insights/index.ts";
import { demoData, memory } from "../../src/memory/index.ts";
import { createTools } from "../../src/tools/index.ts";
import { fixtureHandler } from "../helpers/adapter-suite.ts";
import type { AdapterSuite } from "../helpers/adapter-suite.ts";
import { createClock } from "../helpers/clock.ts";
import { createFetch } from "../helpers/http.ts";
import { suite as heyreach } from "../heyreach/suite.ts";
import { suite as instantly } from "../instantly/suite.ts";
import { suite as smartlead } from "../smartlead/suite.ts";

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

// What a person reads must not look like machine output: no "(s)", a count of
// one in the singular, no ref or internal key, no empty range, steps counted
// from 1 and long waits in days. Checked on every tool and insight, on the
// demo data and on each vendor's fixtures, in the answer and on its card.

const PLURALS =
  "leads|replies|campaigns|senders|variants|steps|days|hours|times|opens|clicks|words|phrases|links|mailboxes|messages|requests|records|domains|entries|tags|lists|clients|sends|bounces|characters";

const MACHINE: readonly (readonly [string, RegExp])[] = [
  ["a (s) plural", /\(s\)/u],
  [
    "a plural after 1",
    new RegExp(`(?<![A-Z][a-z]* |[\\d.,])\\b1 (?:${PLURALS})\\b`, "u"),
  ],
  ["1 of n … are", /\b1 of [\d,]+ \w+ are\b/u],
  ["a ref", /\b(?:memory|instantly|smartlead|heyreach):[^\s:]+:\S/u],
  ["an internal key", /\b(?:email|linkedin):[^\s/]/u],
  ["an empty range", /between (?<low>\S+) and \k<low>(?![\d.])/u],
  ["a step counted from 0", /\b[Ss]tep 0\b|counted from 0/u],
];

const tooManyHours = (sentence: string): boolean =>
  [...sentence.matchAll(/\b(?<hours>\d+) hours\b/gu)].some(
    (match) => Number(match.groups?.hours) > 48
  );

const machineLike = (sentence: string): string | null => {
  const found = MACHINE.find(([, pattern]) => pattern.test(sentence));

  if (found !== undefined) {
    return found[0];
  }

  return tooManyHours(sentence) ? "hours past 48" : null;
};

const inputsFor = (campaign: string): Readonly<Record<string, Json>> => ({
  account_summary: { domain: "example.com" },
  campaign_diagnosis: { campaign },
  campaign_setup: { campaign },
  campaign_trend: { campaign, from: "2026-10-01", to: "2026-11-14" },
  copy_audit: { campaign },
  cross_channel_lead: { person: "person1@example.com" },
  lead_runway: { campaign },
  person_summary: { person: "person1@example.com" },
  personalization_gaps: { campaign },
  pipeline_forecast: { campaign },
  step_funnel: { campaign },
  variant_test: { campaign },
  winning_steps: { campaign },
});

// A card's props are plain JSON already.
const cardText = (spec: CardSpec): Json =>
  structuredClone(
    Object.values(spec.elements).map((element) => element.props)
  ) as Json;

const sweep = async (
  label: string,
  outbound: Outbound,
  campaign: string,
  settle: <Value>(promise: Promise<Value>) => Promise<Value> = async (
    promise
  ) => await promise
): Promise<{ checked: number; found: string[] }> => {
  const given = inputsFor(campaign);
  const found: string[] = [];
  let checked = 0;

  for (const tool of createTools(outbound, {
    extra: insightTools(outbound),
  })) {
    // oxlint-disable-next-line no-await-in-loop -- one tool at a time keeps a failure easy to read.
    const result = await settle(tool.call(given[tool.name] ?? {}));

    if (result.ok) {
      for (const [where, value] of [
        ["data", result.data],
        ["card", cardText(cardFor(tool.name, result))],
      ] as const) {
        for (const sentence of sentences(value)) {
          checked += 1;

          const problem = machineLike(sentence);

          if (problem !== null) {
            found.push(
              `${label} ${tool.name} ${where}, ${problem}: ${sentence}`
            );
          }
        }
      }
    }
  }

  return { checked, found };
};

const overFixtures = (suite: AdapterSuite) => {
  const clock = createClock();

  const outbound = createOutbound({
    adapter: suite.make(),
    fetch: createFetch(fixtureHandler([suite])).fetch,
    plugins: [insights(), identity()],
    rateLimitStore: new MemoryRateLimitStore(),
    runtime: clock.runtime,
    share: 1,
  });

  return { outbound, settle: clock.settle };
};

test("no sentence or card on the demo data or the fixtures reads like machine output", async () => {
  const demo = await sweep(
    "demo",
    createOutbound({
      adapter: memory({ data: demoData({ now: NOW }) }),
      plugins: [insights(), identity()],
    }),
    CAMPAIGN
  );

  const found = [...demo.found];
  let { checked } = demo;

  for (const suite of [instantly, smartlead, heyreach]) {
    const { outbound, settle } = overFixtures(suite);

    // oxlint-disable-next-line no-await-in-loop -- one vendor at a time keeps a failure easy to read.
    const swept = await sweep(
      suite.provider,
      outbound,
      suite.ids.campaign,
      settle
    );

    checked += swept.checked;
    found.push(...swept.found);
  }

  assert.deepEqual(found, []);
  assert.ok(checked > 500, `only ${checked} sentences were checked`);
});

test("the machine-output check catches what it is meant to", () => {
  for (const sentence of [
    "replied 1 time(s)",
    "1 leads remain",
    "1 of 2 senders are ready",
    "1 sent · 1 replies",
    "Stopped at 1 campaigns (max_campaigns).",
    "about 0 replies (between 0 and 0)",
    "Step 0 (counted from 0) brings the most replies",
    "A reply has waited 15909 hours with nothing sent after it.",
    "email:person1@example.com is in 2 campaigns at once.",
    "About memory:default:c1 today",
  ]) {
    assert.notEqual(machineLike(sentence), null, sentence);
  }

  for (const sentence of [
    "replied 1 time",
    "1 lead remains, 2 leads remain",
    "1 of 2 senders is ready",
    "Example Campaign 1 leads at 15.2% reply rate.",
    "about 4 replies (between 1 and 9)",
    "Step 1 brings the most replies",
    "A reply has waited 36 hours with nothing sent after it.",
    "person1@example.com is in 2 campaigns at once.",
    "See https://www.linkedin.com/in/example-person-1 for more.",
  ]) {
    assert.equal(machineLike(sentence), null, sentence);
  }
});
