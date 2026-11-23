// The first run of the whole workspace after a campaign-by-campaign
// back-fill reads everything again (OUT-222): its checkpoint covers the
// workspace, and nothing seeds it from the campaigns' checkpoints, so a run
// that reads every record, as deletion marking needs, is never faked.

import assert from "node:assert/strict";
import { test } from "node:test";

import { createOutbound } from "../src/index.ts";
import { memory } from "../src/memory/index.ts";
import { memoryCheckpointStore, sync } from "../src/sync/index.ts";
import { NOW, world } from "./insights/metered.ts";

const instance = () =>
  createOutbound({
    adapter: memory({ data: world(6, 2), workspaceId: "agency" }),
    plugins: [sync({ checkpoints: memoryCheckpointStore(), now: () => NOW })],
  });

test("the first run of the whole workspace after a back-fill reads every record again", async () => {
  const outbound = instance();
  const all = await outbound.leads.listAll().toArray();

  const backfill = await outbound.sync.run("leads", {
    campaign_name: "*",
    onPage: () => {},
  });

  assert.equal(backfill.complete, true);
  assert.equal(backfill.records, all.length);

  const again = await outbound.sync.run("leads", {
    campaign_name: "*",
    onPage: () => {},
  });

  assert.equal(again.records, 0, "the back-fill's checkpoints are kept");

  let read = 0;

  const whole = await outbound.sync.run("leads", {
    onPage: (items) => {
      read += items.length;
    },
  });

  assert.equal(whole.since, undefined, "no since is seeded from the campaigns");
  assert.equal(whole.resumed, false);
  assert.equal(whole.complete, true);
  assert.equal(read, all.length);

  const next = await outbound.sync.run("leads", { onPage: () => {} });

  assert.notEqual(next.since, undefined);
  assert.equal(next.records, 0);
});
