// OUT-110: one campaign whose Instantly sequence has a step delay of -11
// days. Every insight that reads the sequence still answers, and says why
// that step's wait is unknown; copy_reuse leaves out a campaign it cannot
// read instead of failing the whole workspace.

import assert from "node:assert/strict";
import { test } from "node:test";

import { createOutbound, MemoryRateLimitStore } from "../../src/index.ts";
import { insights } from "../../src/insights/index.ts";
import { fixtureHandler } from "../helpers/adapter-suite.ts";
import { createClock } from "../helpers/clock.ts";
import { fixture } from "../helpers/fixtures.ts";
import { createFetch, json } from "../helpers/http.ts";
import type { RecordedRequest } from "../helpers/http.ts";
import { CAMPAIGN, suite } from "../instantly/suite.ts";
import { NOW } from "./helpers.ts";

const REF = `instantly:client-a:${CAMPAIGN}`;
const OTHER = "01a1d77f-5e23-7a9a-9112-a6f7089f3290";
const NOTE = "Step 4's delay is negative in Instantly (-11 days); left out.";

const NEGATIVE = {
  ...(fixture("instantly", "getCampaign.json") as object),
  ...(fixture("instantly", "getCampaign.negativeDelay.json") as object),
};

const over = (
  answer: (request: RecordedRequest) => Response | undefined = () => {}
) => {
  const clock = createClock();
  const unrouted: string[] = [];
  const fromFixtures = fixtureHandler([suite], unrouted);

  const http = createFetch((request, index) => {
    const path = new URL(request.url).pathname;

    if (path === `/api/v2/campaigns/${CAMPAIGN}`) {
      return json(NEGATIVE);
    }

    return answer(request) ?? fromFixtures(request, index);
  });

  const outbound = createOutbound({
    adapter: suite.make(),
    fetch: http.fetch,
    plugins: [insights()],
    rateLimitStore: new MemoryRateLimitStore(),
    runtime: clock.runtime,
    share: 1,
  });

  return { outbound, settle: clock.settle, unrouted };
};

test("step_funnel answers for a campaign with a negative step delay, and notes the unknown wait", async () => {
  const { outbound, settle, unrouted } = over();

  const result = await settle(
    outbound.insights.stepFunnel({ campaign: REF }, { now: NOW })
  );

  assert.deepEqual(unrouted, []);
  assert.deepEqual(
    result.data.steps.map((step) => step.delayDays),
    [0, 2, 2, null]
  );
  assert.ok(result.meta.notes.includes(NOTE));
});

test("copy_audit, copy_preview and campaign_diagnosis answer for a campaign with a negative step delay", async () => {
  const { outbound, settle, unrouted } = over();

  const audit = await settle(
    outbound.insights.copyAudit({ campaign: REF }, { now: NOW })
  );

  const preview = await settle(
    outbound.insights.copyPreview({ campaign: REF }, { now: NOW })
  );

  const diagnosis = await settle(
    outbound.insights.campaignDiagnosis({ campaign: REF }, { now: NOW })
  );

  assert.deepEqual(unrouted, []);
  assert.ok(audit.meta.notes.includes(NOTE));
  assert.deepEqual(
    preview.data.steps.map((step) => step.delayDays),
    [0, 2, 2, null]
  );
  assert.ok(preview.meta.notes.includes(NOTE));
  assert.ok(diagnosis.meta.notes.includes(NOTE));
});

test("copy_reuse reads past a negative step delay, and leaves out a campaign whose sequence cannot be read", async () => {
  // The other campaign answers with no campaign object: the vendor's fault,
  // a Provider error.
  const { outbound, settle, unrouted } = over((request) =>
    new URL(request.url).pathname === `/api/v2/campaigns/${OTHER}`
      ? json([])
      : undefined
  );

  const result = await settle(outbound.insights.copyReuse({}, { now: NOW }));

  assert.deepEqual(unrouted, []);
  assert.equal(result.meta.complete, false);
  assert.ok(result.meta.notes.includes(NOTE));
  assert.ok(
    result.meta.notes.some((note) =>
      /^Left out .+: its sequence or step stats could not be read/u.test(note)
    ),
    result.meta.notes.join("\n")
  );
  assert.ok(
    result.data.piecesOfCopy > 0,
    "the readable campaign's copy is counted"
  );
});
