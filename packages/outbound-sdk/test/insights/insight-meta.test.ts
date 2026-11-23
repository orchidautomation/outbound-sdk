// What an insight's meta and totals say about the reads behind it: stale
// reads pass through, and a check that read no campaign has no total (OUT-196).

import assert from "node:assert/strict";
import { test } from "node:test";

import { createOutbound } from "../../src/index.ts";
import type { OutboundPlugin } from "../../src/index.ts";
import { insights } from "../../src/insights/index.ts";
import { demoData, memory } from "../../src/memory/index.ts";

const NOW = Date.parse("2026-11-14T00:00:00.000Z");

// Marks the campaign listing as an older answer, as failover does when the vendor is down.
const staleCampaigns: OutboundPlugin = {
  name: "stale-campaigns",
  wrap: async (operation, next) => {
    const output = await next(operation);

    return operation.kind === "campaigns.list"
      ? { ...output, stale: true }
      : output;
  },
};

const instance = (
  options: { readonly paused?: boolean; readonly stale?: boolean } = {}
) => {
  const data = demoData({ now: NOW });

  const campaigns = (data.campaigns ?? []).map((campaign) =>
    options.paused === true
      ? { ...campaign, status: "paused" as const }
      : campaign
  );

  return createOutbound({
    adapter: memory({ data: { ...data, campaigns } }),
    plugins: [insights(), ...(options.stale === true ? [staleCampaigns] : [])],
  });
};

test("an insight's meta.stale is true when a read behind it was stale, and false otherwise", async () => {
  const stale = await instance({ stale: true }).insights.leadCollisions({});
  const fresh = await instance().insights.leadCollisions({});

  assert.equal(stale.meta.stale, true);
  assert.equal(fresh.meta.stale, false);
});

test("lead_collisions and suppression_check give null totals when no campaign in the statuses was read but others exist", async () => {
  const outbound = instance({ paused: true });
  const collisions = await outbound.insights.leadCollisions({});
  const suppression = await outbound.insights.suppressionCheck({});

  for (const answer of [collisions, suppression]) {
    assert.equal(answer.meta.complete, false);
    assert.match(
      answer.data.finding,
      /^No campaign is active, so nothing was checked \(2 campaigns: 2 paused\)\./u
    );
  }

  assert.equal(collisions.data.totals.campaignsRead, 0);
  assert.equal(collisions.data.totals.collisions, null);
  assert.equal(suppression.data.totals.campaignsRead, 0);
  assert.equal(suppression.data.totals.violations, null);
});

test("lead_collisions and suppression_check still count when the statuses match campaigns", async () => {
  const outbound = instance({ paused: true });

  const collisions = await outbound.insights.leadCollisions({
    statuses: ["paused"],
  });

  const suppression = await outbound.insights.suppressionCheck({
    statuses: ["paused"],
  });

  assert.equal(collisions.data.totals.campaignsRead, 2);
  assert.equal(typeof collisions.data.totals.collisions, "number");
  assert.equal(suppression.data.totals.campaignsRead, 2);
  assert.equal(typeof suppression.data.totals.violations, "number");
});
