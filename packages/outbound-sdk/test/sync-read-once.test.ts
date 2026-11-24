// A scoped sync of replies or messages the vendor filters by campaign reads
// the workspace once, from the earliest lower bound, when every campaign has
// finished a run, instead of once per campaign; and goes on campaign by
// campaign when that one read would cost more (BRA-128 item 1).

import assert from "node:assert/strict";
import { test } from "node:test";

import { createOutbound } from "../src/index.ts";
import type {
  CapabilityDeclaration,
  Message,
  ResolveScopeInput,
} from "../src/index.ts";
import { memory } from "../src/memory/index.ts";
import { memoryCheckpointStore, sync } from "../src/sync/index.ts";
import type { Checkpoint, CheckpointStore } from "../src/sync/index.ts";
import { NOW, world } from "./insights/metered.ts";

const DAY = 86_400_000;

/** A memory tool that records the campaign each message listing names. */
const instance = (capabilities: CapabilityDeclaration = {}) => {
  const reads: string[] = [];
  const store = memoryCheckpointStore();
  const saved = new Map<string, Checkpoint>();
  const clock = { now: NOW };

  const checkpoints: CheckpointStore = {
    ...store,
    set: async (key, checkpoint) => {
      saved.set(key, checkpoint);
      await store.set(key, checkpoint);
    },
  };

  const adapter = memory({
    capabilities,
    data: world(6, 3),
    workspaceId: "agency",
  });

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
    plugins: [sync({ checkpoints, now: () => clock.now })],
  });

  return { clock, outbound, reads, saved };
};

const short = (ref: string | null | undefined) =>
  ref?.replace("memory:agency:", "");

test("once every campaign has finished a run, the next run reads the workspace once", async () => {
  const { outbound, reads, saved } = instance();

  const first = await outbound.sync.run("messages", {
    onPage: () => {},
    tag: "even",
  });

  assert.deepEqual(
    reads.toSorted(),
    ["c1", "c3", "c5"],
    "the first run reads each campaign"
  );
  assert.equal(first.records, 18);

  reads.length = 0;
  const seen: (string | undefined)[] = [];

  const second = await outbound.sync.run<Message>("messages", {
    onPage: (_items, page) => {
      seen.push(short(page.campaignRef));
    },
    tag: "even",
  });

  assert.deepEqual(reads, ["(all)"], "one listing, naming no campaign");
  assert.equal(second.records, 0, "nothing is new");
  assert.equal(second.complete, true);
  assert.deepEqual(seen, []);
  assert.ok(
    second.notes.some((note) =>
      note.startsWith("Every campaign had finished a run")
    )
  );
  assert.deepEqual(
    [...saved.values()].map((each) => [
      short(each.campaignRef),
      each.since,
      each.cursor,
    ]),
    [
      ["c1", new Date(NOW).toISOString(), undefined],
      ["c3", new Date(NOW).toISOString(), undefined],
      ["c5", new Date(NOW).toISOString(), undefined],
    ],
    "each campaign's checkpoint moves to this run's start"
  );
});

test("the one read hands each campaign only its own records, and nothing of another", async () => {
  const { clock, outbound, reads } = instance();

  clock.now = NOW - 10 * DAY;
  await outbound.sync.run("messages", { onPage: () => {}, tag: "even" });
  reads.length = 0;
  clock.now = NOW;

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

  assert.deepEqual(reads, ["(all)"]);
  assert.deepEqual(seen, [
    ["c1", ["c1"]],
    ["c3", ["c3"]],
    ["c5", ["c5"]],
  ]);
  assert.equal(
    result.records,
    18,
    "the messages created since, of the scope only"
  );
});

test("a campaign that has not finished a run keeps the scope campaign by campaign", async () => {
  const { outbound, reads } = instance();

  await outbound.sync.run("messages", { onPage: () => {}, tag: "even" });
  await outbound.sync.reset("messages", "memory:agency:c3");
  reads.length = 0;

  await outbound.sync.run("messages", { onPage: () => {}, tag: "even" });

  assert.deepEqual(reads.toSorted(), ["c1", "c3", "c5"]);
});

test("a scope of one campaign, or a vendor with no server date filter, reads each campaign", async () => {
  const cases: [ResolveScopeInput, CapabilityDeclaration][] = [
    [{ campaign_ids: ["c1"] }, {}],
    [{ tag: "even" }, { "messages.since": "client" }],
  ];

  for (const [scope, capabilities] of cases) {
    const { outbound, reads } = instance(capabilities);

    // oxlint-disable-next-line no-await-in-loop -- the second run follows the first
    await outbound.sync.run("messages", { ...scope, onPage: () => {} });
    reads.length = 0;
    // oxlint-disable-next-line no-await-in-loop -- the second run follows the first
    await outbound.sync.run("messages", { ...scope, onPage: () => {} });

    assert.equal(reads.includes("(all)"), false, JSON.stringify(scope));
  }
});

test("a read that would need more pages than the campaigns goes on campaign by campaign", async () => {
  const { clock, outbound, reads, saved } = instance();

  clock.now = NOW - 10 * DAY;
  await outbound.sync.run("messages", { onPage: () => {}, tag: "even" });
  reads.length = 0;
  clock.now = NOW;

  const result = await outbound.sync.run("messages", {
    limit: 1,
    onPage: () => {},
    tag: "even",
  });

  const whole = reads.filter((each) => each === "(all)").length;

  assert.equal(
    whole,
    2,
    "two pages, one fewer than the campaigns, and not the next"
  );
  assert.deepEqual(
    [...new Set(reads.filter((each) => each !== "(all)"))].toSorted(),
    ["c1", "c3", "c5"],
    "then a read per campaign"
  );
  assert.equal(result.complete, true);
  assert.ok(
    result.notes.some((note) => note.includes("did not fit in 2 pages"))
  );
  assert.ok(
    result.records >= 18,
    "every campaign's records, some of them twice"
  );
  assert.deepEqual(
    [...saved.values()].map((each) => [
      short(each.campaignRef),
      each.since,
      each.cursor,
    ]),
    [
      ["c1", new Date(NOW).toISOString(), undefined],
      ["c3", new Date(NOW).toISOString(), undefined],
      ["c5", new Date(NOW).toISOString(), undefined],
    ]
  );
});

test("a one-read run stopped by maxPages resumes the same read", async () => {
  const { clock, outbound, reads } = instance();

  clock.now = NOW - 10 * DAY;
  await outbound.sync.run("messages", { onPage: () => {}, tag: "even" });
  clock.now = NOW;
  reads.length = 0;

  const first = await outbound.sync.run("messages", {
    limit: 20,
    maxPages: 1,
    onPage: () => {},
    tag: "even",
  });

  assert.equal(first.complete, false);
  assert.equal(
    reads.every((each) => each === "(all)"),
    true
  );
  reads.length = 0;

  const rest = await outbound.sync.run("messages", {
    limit: 20,
    onPage: () => {},
    tag: "even",
  });

  assert.equal(rest.resumed, true);
  assert.equal(rest.complete, true);
  assert.equal(
    reads.every((each) => each === "(all)"),
    true
  );
  assert.ok(first.records + rest.records >= 18);
});
