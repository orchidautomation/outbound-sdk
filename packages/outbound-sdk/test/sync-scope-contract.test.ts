// What SendLens pins of a scoped sync (OUT-213, OUT-214): campaign_name "*"
// is every campaign, a resolved scope syncs in the order of its campaigns,
// and resolved is accepted when its provider and workspace match.

import assert from "node:assert/strict";
import { test } from "node:test";

import { createOutbound, OutboundError, resolveScope } from "../src/index.ts";
import type { ResolvedScope } from "../src/index.ts";
import { memory } from "../src/memory/index.ts";
import { memoryCheckpointStore, sync } from "../src/sync/index.ts";
import { NOW, world } from "./insights/metered.ts";

const instance = (workspaceId = "agency") =>
  createOutbound({
    adapter: memory({ data: world(4, 2), workspaceId }),
    plugins: [sync({ checkpoints: memoryCheckpointStore(), now: () => NOW })],
  });

const short = (ref: string | undefined) => ref?.replace("memory:agency:", "");

test('campaign_name "*" covers every campaign', async () => {
  const outbound = instance();
  const every = await outbound.campaigns.listAll().toArray();
  const resolved = await resolveScope(outbound, { campaign_name: "*" });

  assert.equal(every.length, 4);
  assert.deepEqual(
    resolved.campaigns.map((campaign) => campaign.ref).toSorted(),
    every.map((campaign) => campaign.ref).toSorted()
  );

  const leads = await outbound.sync.run("leads", {
    campaign_name: "*",
    onPage: () => {},
  });

  assert.equal(leads.records, 8);
  assert.equal(leads.scope?.campaigns.length, every.length);
});

test("a glob other than * leaves out the campaigns it does not match", async () => {
  const resolved = await resolveScope(instance(), { campaign_name: "*c2" });

  assert.deepEqual(
    resolved.campaigns.map((campaign) => short(campaign.ref)),
    ["c2"]
  );
});

test("a resolved scope syncs its campaigns in the order it lists them", async () => {
  const outbound = instance();
  const found = await resolveScope(outbound, { campaign_name: "*" });
  const order = ["c3", "c1", "c4", "c2"];

  // The caller's own order, such as active campaigns first.
  const resolved: ResolvedScope = {
    ...found,
    campaigns: order.flatMap((id) =>
      found.campaigns.filter((campaign) => short(campaign.ref) === id)
    ),
  };

  const pages: (string | undefined)[] = [];

  const result = await outbound.sync.run("leads", {
    onPage: (_items, page) => {
      pages.push(short(page.campaignRef));
    },
    resolved,
  });

  assert.deepEqual([...new Set(pages)], order);
  assert.deepEqual(
    result.scope?.campaigns.map((each) => short(each.campaignRef)),
    order
  );
});

test("resolved is accepted when its provider and workspace match, whatever its campaigns", async () => {
  const outbound = instance();
  const found = await resolveScope(outbound, { campaign_name: "*" });

  // A caller may filter the list it was given: only provider and workspace are checked.
  const result = await outbound.sync.run("leads", {
    onPage: () => {},
    resolved: {
      ...found,
      campaigns: found.campaigns.filter(
        (campaign) => short(campaign.ref) === "c2"
      ),
    },
  });

  assert.equal(result.records, 2);
  assert.deepEqual(
    result.scope?.campaigns.map((each) => short(each.campaignRef)),
    ["c2"]
  );
});

test("resolved of another provider or workspace, or without a campaign list, is Invalid", async () => {
  const outbound = instance();
  const foreign = await resolveScope(instance("other"), { campaign_name: "*" });
  const own = await resolveScope(outbound, { campaign_name: "*" });

  for (const resolved of [
    foreign,
    { ...own, meta: { ...own.meta, provider: "instantly" } },
    { ...own, campaigns: undefined },
  ]) {
    await assert.rejects(
      outbound.sync.run("leads", {
        onPage: () => {},
        // SAFETY: a caller without types can pass any object.
        resolved: resolved as unknown as ResolvedScope,
      }),
      (error) => OutboundError.is(error) && error.code === "Invalid"
    );
  }
});
