// A scoped sync of a collection the vendor filters by campaign only after
// reading it all (messages.byCampaign or replies.byCampaign "client") reads
// it once and splits it here, with a checkpoint per campaign (OUT-212).

import assert from "node:assert/strict";
import { test } from "node:test";

import { combine } from "../src/combine/index.ts";
import { createOutbound, resolveScope } from "../src/index.ts";
import type { CapabilityDeclaration, Message } from "../src/index.ts";
import { memory } from "../src/memory/index.ts";
import { memoryCheckpointStore, sync } from "../src/sync/index.ts";
import type { Checkpoint, CheckpointStore } from "../src/sync/index.ts";
import { NOW, world } from "./insights/metered.ts";

const split = {
  "messages.byCampaign": "client",
  "replies.byCampaign": "client",
} as const;

/** A memory tool that counts its message and reply listings, and the campaign each names. */
const instance = (
  capabilities: CapabilityDeclaration = split,
  data = world(6, 3)
) => {
  const reads: string[] = [];
  const store = memoryCheckpointStore();
  const written: Checkpoint[] = [];

  const checkpoints: CheckpointStore = {
    ...store,
    set: async (key, checkpoint) => {
      written.push(checkpoint);
      await store.set(key, checkpoint);
    },
  };

  const adapter = memory({ capabilities, data, workspaceId: "agency" });

  const counted = {
    ...adapter,
    listMessages: (
      query: { readonly campaignId?: string },
      ...rest: unknown[]
    ) => {
      reads.push(query.campaignId ?? "(all)");

      // SAFETY: the same read, with the arguments it was given.
      return (adapter.listMessages as (...all: unknown[]) => unknown)(
        query,
        ...rest
      );
    },
  } as typeof adapter;

  const outbound = createOutbound({
    adapter: counted,
    plugins: [sync({ checkpoints, now: () => NOW })],
  });

  return { outbound, reads, written };
};

const short = (ref: string | null | undefined) =>
  ref?.replace("memory:agency:", "");

test("a scope of a collection filtered here is read once, and each campaign gets only its own", async () => {
  const { outbound, reads } = instance();
  const seen: [string | undefined, (string | undefined)[]][] = [];

  const result = await outbound.sync.run<Message>("messages", {
    onPage: (items, page) => {
      seen.push([
        short(page.campaignRef),
        [...new Set(items.map((item) => short(item.campaignRef)))],
      ]);
    },
    tag: "even",
  });

  assert.deepEqual(
    [...new Set(reads)],
    ["(all)"],
    "no listing names a campaign"
  );
  assert.deepEqual(seen, [
    ["c1", ["c1"]],
    ["c3", ["c3"]],
    ["c5", ["c5"]],
  ]);
  assert.equal(result.records, 18);
  assert.deepEqual(
    result.scope?.campaigns.map((each) => [
      short(each.campaignRef),
      each.records,
      each.complete,
    ]),
    [
      ["c1", 6, true],
      ["c3", 6, true],
      ["c5", 6, true],
    ]
  );
});

test("where the vendor filters by campaign, each campaign is still read on its own", async () => {
  const { outbound, reads } = instance({
    "messages.byCampaign": "server",
    "replies.byCampaign": "server",
  });

  await outbound.sync.run("messages", { onPage: () => {}, tag: "even" });

  assert.deepEqual([...new Set(reads)].toSorted(), ["c1", "c3", "c5"]);
});

test("each campaign keeps its own checkpoint, so reset and a second run work as in any scope", async () => {
  const { outbound, written } = instance();
  const resolved = await resolveScope(outbound, { tag: "even" });

  await outbound.sync.run("messages", { onPage: () => {}, resolved });

  const again = await outbound.sync.run("messages", {
    onPage: () => {},
    resolved,
  });

  assert.equal(again.records, 0);
  assert.equal(again.since, new Date(NOW - 5 * 60_000).toISOString());

  // Forgetting one campaign walks again from the start, and only that one has records.
  await outbound.sync.reset("messages", "memory:agency:c3");

  const after = await outbound.sync.run("messages", {
    onPage: () => {},
    resolved,
  });

  assert.equal(after.since, undefined);
  assert.deepEqual(
    after.scope?.campaigns.map((each) => [
      short(each.campaignRef),
      each.records,
    ]),
    [
      ["c1", 6],
      ["c3", 6],
      ["c5", 6],
    ],
    "a record can be delivered again: the walk starts from the earliest campaign"
  );

  assert.deepEqual(
    [...new Set(written.map((each) => short(each.campaignRef)))],
    ["c1", "c3", "c5"],
    "every checkpoint names its campaign"
  );
});

test("maxPages stops the one walk for every campaign, and the next run resumes it", async () => {
  const { outbound } = instance(split, world(4, 4));
  const resolved = await resolveScope(outbound, { campaign_name: "*" });

  const first = await outbound.sync.run("messages", {
    limit: 8,
    maxPages: 1,
    onPage: () => {},
    resolved,
  });

  assert.equal(first.complete, false);
  assert.equal(first.pages, 1);
  assert.equal(first.records, 8);

  const second = await outbound.sync.run("messages", {
    limit: 8,
    onPage: () => {},
    resolved,
  });

  assert.equal(second.resumed, true);
  assert.equal(second.complete, true);
  assert.equal(first.records + second.records, 32);
});

test("a combined instance is read campaign by campaign, since its members may filter", async () => {
  const outbound = createOutbound({
    adapter: combine([
      memory({ capabilities: split, data: world(2, 2), workspaceId: "a" }),
      memory({ data: world(2, 2), workspaceId: "b" }),
    ]),
    plugins: [sync({ checkpoints: memoryCheckpointStore(), now: () => NOW })],
  });

  const result = await outbound.sync.run("messages", {
    campaign_name: "*",
    onPage: () => {},
  });

  assert.equal(outbound.capabilities["messages.byCampaign"], "client");
  assert.equal(
    result.notes.some((note) => note.includes("read them once")),
    false
  );
  assert.equal(result.records, 16);
});
