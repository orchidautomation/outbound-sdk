import assert from "node:assert/strict";
import { test } from "node:test";

import { createOutbound, OutboundError } from "../src/index.ts";
import { insights } from "../src/insights/index.ts";
import { memory } from "../src/memory/index.ts";
import type { MemoryData } from "../src/memory/index.ts";
import * as emailbison from "./emailbison/suite.ts";
import { harness } from "./helpers/adapter-suite.ts";
import * as heyreach from "./heyreach/suite.ts";
import { ref } from "./insights/copy-helpers.ts";
import { NOW, single } from "./insights/helpers.ts";
import * as instantly from "./instantly/suite.ts";
import * as smartlead from "./smartlead/suite.ts";

const variant = [{ body: "Hello", subject: "Quick question" }];

const DATA: MemoryData = {
  campaigns: [
    {
      id: "c1",
      steps: [
        { delayDays: 0, variants: variant },
        { delayDays: 3, variants: variant },
      ],
    },
  ],
  stats: [
    {
      campaignId: "c1",
      counts: { replied: 2, sent: 60 },
      date: "2026-11-01",
      stepIndex: 0,
    },
    {
      campaignId: "c1",
      counts: { replied: 1, sent: 40 },
      date: "2026-11-02",
      stepIndex: 0,
    },
    {
      campaignId: "c1",
      counts: { replied: 3, sent: 50 },
      date: "2026-11-02",
      stepIndex: 1,
    },
  ],
};

const refusedByStepDay = (error: unknown): boolean =>
  error instanceof OutboundError &&
  error.code === "Unsupported" &&
  error.message.includes("stats.byStepDay");

test("an adapter that declares stats.byStepDay serves a row per step and day", async () => {
  // A custom adapter over stored history, named as its own provider.
  const outbound = createOutbound({
    adapter: memory({ data: DATA, name: "stored" }),
  });

  const { rows } = await outbound
    .campaign("c1")
    .stats({ by: "day", scope: "step" });

  assert.deepEqual(
    rows.map((row) => [row.date, row.stepIndex, row.sent, row.replied]),
    [
      ["2026-11-01", 0, 60, 2],
      ["2026-11-02", 0, 40, 1],
      ["2026-11-02", 1, 50, 3],
    ]
  );
});

test("an adapter that does not declare stats.byStepDay is refused, and its step totals still read", async () => {
  const outbound = createOutbound({
    adapter: memory({ capabilities: { "stats.byStepDay": false }, data: DATA }),
  });

  await assert.rejects(
    outbound.campaign("c1").stats({ by: "day", scope: "step" }),
    refusedByStepDay
  );

  const totals = await outbound.campaign("c1").stats({ scope: "step" });

  assert.equal(totals.rows.length, 2);
});

test("every vendor adapter refuses step stats by day before any request", async () => {
  for (const vendor of [instantly, smartlead, emailbison, heyreach]) {
    const { outbound, requests, settle } = harness(vendor.suite);

    assert.equal(outbound.capabilities["stats.byStepDay"], false);

    // oxlint-disable-next-line no-await-in-loop -- one vendor at a time keeps its request count its own.
    await assert.rejects(
      settle(
        outbound
          .campaign(vendor.CAMPAIGN)
          .stats({ by: "day", retries: 0, scope: "step" })
      ),
      (error) => error instanceof OutboundError && error.code === "Unsupported"
    );
    assert.equal(requests.length, 0, vendor.suite.provider);
  }
});

/** An instance whose adapter records each stats read it serves. */
const counted = () => {
  const adapter = memory({ data: DATA, workspaceId: "agency" });
  const reads: string[] = [];
  const read = adapter.stats;

  assert.ok(read);

  const outbound = createOutbound({
    adapter: {
      ...adapter,
      stats: async (query, ctx) => {
        reads.push(`${query.scope} ${query.by}`);

        return await read(query, ctx);
      },
    },
    plugins: [insights()],
  });

  return { outbound, reads };
};

test("step_funnel with by_day returns each day's funnel for one more stats read", async () => {
  const one = counted();
  const two = counted();

  const plain = await one.outbound.insights.stepFunnel(
    { campaign: ref("c1") },
    { now: NOW }
  );

  const daily = await two.outbound.insights.stepFunnel(
    { by_day: true, campaign: ref("c1") },
    { now: NOW }
  );

  assert.deepEqual(one.reads, ["step total"]);
  assert.deepEqual(two.reads, ["step total", "step day"]);
  assert.equal(plain.data.days, null);
  assert.deepEqual(daily.data.steps, plain.data.steps);
  assert.deepEqual(daily.data.days, [
    {
      date: "2026-11-01",
      steps: [{ replies: 2, sent: 60, stepIndex: 0, stepNumber: 1 }],
    },
    {
      date: "2026-11-02",
      steps: [
        { replies: 1, sent: 40, stepIndex: 0, stepNumber: 1 },
        { replies: 3, sent: 50, stepIndex: 1, stepNumber: 2 },
      ],
    },
  ]);
});

test("step_funnel with by_day is refused before any read without stats.byStepDay, and runs without by_day", async () => {
  const outbound = single(DATA, { "stats.byStepDay": false });

  await assert.rejects(
    outbound.insights.stepFunnel(
      { by_day: true, campaign: ref("c1") },
      { now: NOW }
    ),
    (error) =>
      refusedByStepDay(error) &&
      error instanceof Error &&
      error.message.includes("for this input")
  );

  const result = await outbound.insights.stepFunnel(
    { campaign: ref("c1") },
    { now: NOW }
  );

  assert.equal(result.data.days, null);
});
