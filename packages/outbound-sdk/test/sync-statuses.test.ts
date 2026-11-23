// sync.run and resolveScope narrow a scope by campaign status (OUT-211), so
// active campaigns can be synced first and the rest after, with no
// campaign read twice and the same checkpoint keys as any scoped run.

import assert from "node:assert/strict";
import { test } from "node:test";

import { createOutbound, OutboundError, resolveScope } from "../src/index.ts";
import type { CampaignStatus } from "../src/index.ts";
import { memory } from "../src/memory/index.ts";
import { memoryCheckpointStore, sync } from "../src/sync/index.ts";
import { NOW, world } from "./insights/metered.ts";

const instance = () => {
  const reads: string[] = [];
  const adapter = memory({ data: world(6, 2), workspaceId: "agency" });
  let requests = 0;

  const counted = {
    ...adapter,
    listCampaigns: (...all: unknown[]) => {
      requests += 1;

      // SAFETY: the same read, with the arguments it was given.
      return (adapter.listCampaigns as (...args: unknown[]) => unknown)(...all);
    },
    listLeads: (
      query: { readonly campaignId?: string },
      ...rest: unknown[]
    ) => {
      requests += 1;
      reads.push(query.campaignId ?? "(all)");

      // SAFETY: the same read, with the arguments it was given.
      return (adapter.listLeads as (...args: unknown[]) => unknown)(
        query,
        ...rest
      );
    },
  } as typeof adapter;

  const outbound = createOutbound({
    adapter: counted,
    plugins: [sync({ checkpoints: memoryCheckpointStore(), now: () => NOW })],
  });

  return { outbound, reads, requests: () => requests };
};

const short = (ref: string | undefined) => ref?.replace("memory:agency:", "");

test("active campaigns first, then the rest: every campaign is read once", async () => {
  const { outbound, reads } = instance();
  const all = await outbound.campaigns.listAll().toArray();

  const statusOf = new Map(
    all.map((campaign) => [short(campaign.ref), campaign.status])
  );

  const others = [...new Set(all.map((campaign) => campaign.status))].filter(
    (status) => status !== "active"
  );

  const active = await outbound.sync.run("leads", {
    onPage: () => {},
    statuses: ["active"],
  });

  const rest = await outbound.sync.run("leads", {
    onPage: () => {},
    statuses: others,
  });

  const first =
    active.scope?.campaigns.map((each) => short(each.campaignRef)) ?? [];

  assert.ok(first.length > 0);
  assert.equal(
    first.every((id) => statusOf.get(id) === "active"),
    true
  );
  assert.equal(
    rest.scope?.campaigns.every(
      (each) => statusOf.get(short(each.campaignRef)) !== "active"
    ),
    true
  );
  assert.deepEqual(
    reads.toSorted(),
    all.map((campaign) => campaign.sourceId).toSorted(),
    "each campaign once"
  );
  assert.equal(active.records + rest.records, 12);
  assert.match(active.notes.join(" "), /Campaign scope \(status active\)/u);
});

test("a status run keeps the checkpoint any scoped run of that campaign left", async () => {
  const { outbound } = instance();
  const found = await resolveScope(outbound, { statuses: ["active"] });

  await outbound.sync.run("leads", {
    campaign_ids: found.campaigns.map((each) => each.ref),
    onPage: () => {},
  });

  const again = await outbound.sync.run("leads", {
    onPage: () => {},
    statuses: ["active"],
  });

  assert.equal(again.records, 0);
  assert.equal(again.since, new Date(NOW - 5 * 60_000).toISOString());
});

test("statuses narrow a tag, and resolveScope takes them too", async () => {
  const { outbound } = instance();
  const statuses: CampaignStatus[] = ["active", "paused"];
  const both = await resolveScope(outbound, { statuses, tag: "even" });
  const tagged = await resolveScope(outbound, { tag: "even" });

  assert.deepEqual(
    both.campaigns.map((each) => each.ref),
    tagged.campaigns
      .filter((each) => statuses.includes(each.status))
      .map((each) => each.ref)
  );
  assert.equal(both.meta.scope, "tag even and status active or paused");
  assert.equal(both.meta.tools[0]?.filter, "here");
});

test("an empty or unknown status, or statuses with campaignId or resolved, is Invalid before any request", async () => {
  const { outbound: other } = instance();
  const own = await resolveScope(other, { statuses: ["active"] });

  for (const options of [
    { statuses: [] },
    { statuses: ["running"] },
    { campaignId: "c1", statuses: ["active"] },
    { resolved: own, statuses: ["active"] },
  ]) {
    const { outbound, requests } = instance();

    await assert.rejects(
      outbound.sync.run("leads", {
        // SAFETY: a caller without types can pass any value.
        ...(options as { statuses: CampaignStatus[] }),
        onPage: () => {},
      }),
      (error) => OutboundError.is(error) && error.code === "Invalid",
      JSON.stringify(options.statuses)
    );
    assert.equal(requests(), 0);
  }

  await assert.rejects(
    resolveScope(other, { statuses: [] }),
    (error) => OutboundError.is(error) && error.code === "Invalid"
  );
});
