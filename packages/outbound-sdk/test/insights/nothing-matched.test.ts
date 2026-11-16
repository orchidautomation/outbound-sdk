// A workspace with no campaign in the states an insight reads by default
// (OUT-127). Reading no campaign is not a clean run: the answer is marked
// incomplete, with a note counting the campaigns in other states.

import assert from "node:assert/strict";
import { test } from "node:test";

import { budget } from "../../src/budget/index.ts";
import { cardFor } from "../../src/cards/index.ts";
import { runInsightByName } from "../../src/insights/index.ts";
import type { MemoryData } from "../../src/memory/index.ts";
import { read } from "../cards/helpers.ts";
import { NOW, single } from "./helpers.ts";
import { over, settled, world } from "./metered.ts";

const NOTHING_ACTIVE: MemoryData = {
  blocklist: [{ id: "b1", kind: "email", value: "blocked@example.com" }],
  campaigns: [
    { id: "c1", name: "Draft one", status: "draft" },
    { id: "c2", name: "Done one", status: "completed" },
    { id: "c3", name: "Done two", status: "completed" },
  ],
  leads: [
    { campaignId: "c2", email: "lead1@example.com", id: "l1" },
    { campaignId: "c3", email: "lead1@example.com", id: "l2" },
  ],
  senders: [{ address: "s1@example.com", campaignIds: ["c2"], id: "s1" }],
};

const NOTE =
  "No campaign is active, so nothing was checked (3 campaigns: 2 completed, 1 draft). Pass statuses to check the others.";

for (const name of [
  "lead_collisions",
  "suppression_check",
  "bounce_watch",
  "sender_load",
]) {
  test(`${name} says it checked nothing when no campaign is active`, async () => {
    const result = await runInsightByName(
      single(NOTHING_ACTIVE),
      name,
      {},
      {
        now: NOW,
      }
    );

    assert.equal(result.meta.complete, false);
    assert.ok(result.meta.notes.includes(NOTE), result.meta.notes.join("\n"));
    assert.ok(read(cardFor(name, result)).includes(NOTE));
  });
}

test("the campaigns asked for by statuses are read as before", async () => {
  const result = await single(NOTHING_ACTIVE).insights.leadCollisions(
    { statuses: ["completed"] },
    { now: NOW }
  );

  assert.equal(result.data.totals.campaignsRead, 2);
  assert.ok(!result.meta.notes.includes(NOTE));
});

test("a workspace with no campaigns at all is a clean, empty answer", async () => {
  const result = await single({ campaigns: [] }).insights.bounceWatch(
    {},
    { now: NOW }
  );

  assert.equal(result.meta.complete, true);
  assert.deepEqual(result.meta.notes, []);
});

test("a request cap that cuts the campaign listing short never turns a kept answer into a failure", async () => {
  // Under 2 the run is refused before its first request; from 4 it finishes.
  for (const cap of [2, 3]) {
    const { outbound } = over(world(3, 3), {
      plugins: [budget({ maxRequests: cap, per: "run" })],
    });

    // oxlint-disable-next-line no-await-in-loop -- each cap is its own run, one after another.
    const outcome = await settled(
      runInsightByName(outbound, "sender_load", {}, { now: NOW })
    );

    assert.ok(!("rejected" in outcome), `a budget of ${cap} failed the run`);
    assert.equal(outcome.meta.complete, false);
  }
});

test("a request cap that stops the count of the other campaigns still says nothing was checked", async () => {
  // One request lists the active campaigns, so the count has none left.
  const { outbound } = over(NOTHING_ACTIVE, {
    plugins: [budget({ maxRequests: 1, per: "run" })],
  });

  const result = await runInsightByName(
    outbound,
    "lead_collisions",
    {},
    { now: NOW }
  );

  assert.equal(result.meta.complete, false);
  assert.deepEqual(result.meta.notes, [
    "No campaign is active, so nothing was checked; a request cap stopped the count of the others.",
  ]);
});
