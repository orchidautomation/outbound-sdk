// sync.run and resolveScope take the campaign scope every insight takes
// (OUT-202): the scope's campaigns are found first, and nothing of another
// campaign is read. Each campaign keeps its own checkpoint.

import assert from "node:assert/strict";
import { test } from "node:test";

import {
  createOutbound,
  MemoryRateLimitStore,
  OutboundError,
  resolveScope,
} from "../src/index.ts";
import type { Adapter, Lead, Message, Sender } from "../src/index.ts";
import { memory } from "../src/memory/index.ts";
import { memoryCheckpointStore, sync } from "../src/sync/index.ts";
import type { Checkpoint, CheckpointStore } from "../src/sync/index.ts";
import { createFetch, json } from "./helpers/http.ts";
import { metered, NOW, world } from "./insights/metered.ts";

const READS = new Set([
  "listLeads",
  "listMessages",
  "listReplies",
  "listSenders",
]);

/** The metered tool, recording the campaign every per-campaign read names. */
const spied = (adapter: Adapter, named: string[], calls: string[]): Adapter =>
  Object.fromEntries(
    Object.entries(adapter).map(([name, value]) => {
      // oxlint-disable-next-line anti-slop/no-runtime-typeof -- picking the adapter's read functions out of its fields
      if (typeof value !== "function" || !/^(?:list|get)/u.test(name)) {
        return [name, value];
      }

      return [
        name,
        (
          query: { readonly campaignId?: string } | undefined,
          ...rest: unknown[]
        ) => {
          calls.push(name);

          if (READS.has(name)) {
            named.push(query?.campaignId ?? "(workspace)");
          }

          // SAFETY: the same read, called with the arguments it was given.
          return (value as (...all: unknown[]) => unknown)(query, ...rest);
        },
      ];
    })
  ) as unknown as Adapter;

const instance = (
  data = world(6, 5),
  adapter = metered(data),
  checkpoints = memoryCheckpointStore()
) => {
  const named: string[] = [];
  const calls: string[] = [];
  const http = createFetch(() => json({}));

  const outbound = createOutbound({
    adapter: spied(adapter, named, calls),
    fetch: http.fetch,
    plugins: [sync({ checkpoints, now: () => NOW })],
    rateLimitStore: new MemoryRateLimitStore(),
    retries: 0,
    share: 1,
  });

  return { calls, checkpoints, http, named, outbound };
};

const short = (ref: string | null) => ref?.replace("memory:agency:", "");

test("a scoped sync reads only the scope's campaigns, each with its own checkpoint", async () => {
  const { calls, http, named, outbound } = instance();
  const seen: string[] = [];

  const first = await outbound.sync.run<Message>("messages", {
    onPage: (items) => {
      seen.push(...items.map((item) => short(item.campaignRef) ?? ""));
    },
    tag: "even",
  });

  assert.deepEqual([...new Set(named)].toSorted(), ["c1", "c3", "c5"]);
  assert.deepEqual([...new Set(seen)].toSorted(), ["c1", "c3", "c5"]);
  assert.equal(calls.filter((call) => call === "listCampaigns").length, 1);
  assert.equal(first.records, 24);
  assert.equal(first.complete, true);
  assert.equal(first.requests, http.requests.length);
  assert.deepEqual(
    first.scope?.campaigns.map((each) => [
      short(each.campaignRef),
      each.records,
    ]),
    [
      ["c1", 8],
      ["c3", 8],
      ["c5", 8],
    ]
  );
  assert.deepEqual(first.scope?.meta.tools, [
    { campaigns: 3, filter: "here", tool: "memory:agency" },
  ]);
  assert.match(
    first.notes.join(" "),
    /Campaign scope \(tag even\): 3 campaigns/u
  );

  // The next run starts each campaign from when the first one began.
  const second = await outbound.sync.run<Message>("messages", {
    onPage: () => {},
    tag: "even",
  });

  assert.equal(second.records, 0);
  assert.equal(second.since, new Date(NOW - 5 * 60_000).toISOString());
});

test("campaign ids are read by id with no listing, and the scope names its campaigns", async () => {
  const { calls, named, outbound } = instance();

  const result = await outbound.sync.run("leads", {
    campaign_ids: ["memory:agency:c2", "c4"],
    onPage: () => {},
  });

  assert.equal(calls.includes("listCampaigns"), false);
  assert.deepEqual([...new Set(named)].toSorted(), ["c2", "c4"]);
  assert.equal(result.records, 10);
  assert.equal(result.scope?.meta.tools[0]?.filter, "id");
});

test("maxPages stops a scoped run across campaigns, and the next run finishes it", async () => {
  const { outbound } = instance(world(3, 25));
  const pages: number[] = [];

  const onPage = (items: readonly unknown[]) => {
    pages.push(items.length);
  };

  const first = await outbound.sync.run("leads", {
    campaign_name: "Campaign c*",
    maxPages: 4,
    onPage,
  });

  assert.equal(first.complete, false);
  assert.equal(first.pages, 4);
  assert.deepEqual(
    first.scope?.campaigns.map((each) => each.complete),
    [true, false, false]
  );

  const second = await outbound.sync.run("leads", {
    campaign_name: "Campaign c*",
    onPage,
  });

  assert.equal(second.complete, true);
  assert.equal(first.records + second.records, 75);
});

test("a sender of several campaigns is handed out once per scoped run", async () => {
  const { outbound } = instance();
  const refs: string[] = [];

  await outbound.sync.run<Sender>("senders", {
    onPage: (items) => {
      refs.push(...items.map((item) => item.ref));
    },
    tag: "odd",
  });

  assert.ok(refs.length > 0);
  assert.equal(new Set(refs).size, refs.length);
});

test("the campaigns collection under a scope is the scope's campaigns", async () => {
  const { outbound } = instance();
  const names: (string | null)[] = [];

  const result = await outbound.sync.run("campaigns", {
    campaign_name: "/campaign c[12]/i",
    onPage: (items) => {
      names.push(...items.map((item) => item.sourceId));
    },
  });

  assert.deepEqual(names, ["c1", "c2"]);
  assert.equal(result.records, 2);
});

test("a malformed or tagless scope is refused before any request", async () => {
  for (const [options, code, message] of [
    [
      { campaignId: "c1", tag: "even" },
      "Invalid",
      /campaignId or a campaign scope/u,
    ],
    [{ campaign_ids: [] }, "Invalid", /^sync: campaign_ids: Too small/u],
    [{ tag: "  " }, "Invalid", /^sync: tag: Too small/u],
    [{ campaign_name: "/(/" }, "Invalid", /not a valid regular expression/u],
  ] as const) {
    const { http, outbound } = instance();

    await assert.rejects(
      outbound.sync.run("messages", {
        ...(options as object),
        onPage: () => {},
      }),
      (error) =>
        OutboundError.is(error) &&
        error.code === code &&
        message.test(error.message),
      JSON.stringify(options)
    );
    assert.equal(http.requests.length, 0);
  }

  const calls: string[] = [];

  const tagless = createOutbound({
    adapter: spied(
      memory({ capabilities: { "campaigns.byTag": false }, data: world(2, 1) }),
      [],
      calls
    ),
    plugins: [sync({ checkpoints: memoryCheckpointStore() })],
  });

  for (const run of [
    tagless.sync.run("replies", { onPage: () => {}, tag: "even" }),
    resolveScope(tagless, { tag: "even" }),
  ]) {
    // oxlint-disable-next-line no-await-in-loop -- each refusal checked on its own
    await assert.rejects(
      run,
      (error) =>
        OutboundError.is(error) &&
        error.code === "Unsupported" &&
        /carry no tags/u.test(error.message)
    );
  }

  assert.deepEqual(calls, []);
});

test("resolveScope returns the scope's campaigns and how they were found", async () => {
  const { http, outbound } = instance();

  const tagged = await resolveScope(outbound, { tag: "EVEN" });

  assert.deepEqual(
    tagged.campaigns.map((campaign) => campaign.sourceId),
    ["c1", "c3", "c5"]
  );
  assert.equal(tagged.meta.evidence, "exact");
  assert.equal(tagged.meta.requests, http.requests.length);
  assert.equal(tagged.meta.scope, "tag EVEN");
  assert.deepEqual(tagged.meta.tools, [
    { campaigns: 3, filter: "here", tool: "memory:agency" },
  ]);
  assert.match(tagged.meta.notes.join(" "), /filtered here/u);

  const both = await resolveScope(outbound, {
    campaign_ids: ["c1", "c2"],
    tag: "even",
  });

  assert.deepEqual(
    both.campaigns.map((campaign) => campaign.sourceId),
    ["c1"]
  );
  assert.equal(both.meta.tools[0]?.filter, "id");

  await assert.rejects(
    resolveScope(outbound, {}),
    (error) =>
      OutboundError.is(error) &&
      error.code === "Invalid" &&
      /at least one of campaign_ids, tag and campaign_name/u.test(error.message)
  );
});

/** A memory store that records every checkpoint it is given. */
const recording = (): {
  readonly store: CheckpointStore;
  readonly written: Checkpoint[];
} => {
  const inner = memoryCheckpointStore();
  const written: Checkpoint[] = [];

  return {
    store: {
      ...inner,
      set: (key, checkpoint) => {
        written.push(checkpoint);

        return inner.set(key, checkpoint);
      },
    },
    written,
  };
};

test("each checkpoint and each page name their campaign by ref (OUT-208)", async () => {
  const { store, written } = recording();
  const { outbound } = instance(world(6, 5), undefined, store);
  const told: (string | undefined)[] = [];
  const mismatched: string[] = [];

  await outbound.sync.run<Message>("messages", {
    onPage: (items, page) => {
      told.push(page.campaignRef);
      mismatched.push(
        ...items
          .filter((item) => item.campaignRef !== page.campaignRef)
          .map((item) => item.ref)
      );
    },
    tag: "even",
  });

  const scoped = ["c1", "c3", "c5"].map((id) => `memory:agency:${id}`);

  assert.deepEqual([...new Set(told)].toSorted(), scoped);
  assert.deepEqual(mismatched, []);
  assert.deepEqual(
    [...new Set(written.map((each) => each.campaignRef))].toSorted(),
    scoped
  );

  // A bare vendor id is named by its ref; the workspace's checkpoint by none.
  written.length = 0;
  told.length = 0;

  await outbound.sync.run<Lead>("leads", {
    campaignId: "c2",
    onPage: (_items, page) => {
      told.push(page.campaignRef);
    },
  });

  assert.deepEqual([...new Set(told)], ["memory:agency:c2"]);
  assert.ok(written.length > 0);
  assert.ok(written.every((each) => each.campaignRef === "memory:agency:c2"));

  written.length = 0;
  told.length = 0;

  await outbound.sync.run<Lead>("leads", {
    onPage: (_items, page) => {
      told.push(page.campaignRef);
    },
  });

  assert.deepEqual([...new Set(told)], [undefined]);
  assert.ok(written.length > 0);
  assert.ok(written.every((each) => !("campaignRef" in each)));

  // campaigns is listed whole, so a campaignId names no campaign there.
  told.length = 0;

  await outbound.sync.run("campaigns", {
    campaignId: "c2",
    onPage: (_items, page) => {
      told.push(page.campaignRef);
    },
  });

  assert.deepEqual([...new Set(told)], [undefined]);
});

test("a scope resolved once syncs every collection without finding it again (OUT-209)", async () => {
  const { calls, http, outbound } = instance();
  const resolved = await resolveScope(outbound, { tag: "even" });

  assert.equal(calls.filter((call) => call === "listCampaigns").length, 1);

  const before = http.requests.length;
  const seen: string[] = [];

  const messages = await outbound.sync.run<Message>("messages", {
    onPage: (items) => {
      seen.push(...items.map((item) => short(item.campaignRef) ?? ""));
    },
    resolved,
  });

  const leads = await outbound.sync.run("leads", {
    onPage: () => {},
    resolved,
  });

  assert.equal(calls.filter((call) => call === "listCampaigns").length, 1);
  assert.deepEqual([...new Set(seen)].toSorted(), ["c1", "c3", "c5"]);
  assert.equal(messages.records, 24);
  assert.equal(leads.records, 15);
  assert.equal(
    messages.requests + leads.requests,
    http.requests.length - before,
    "the requests that found the scope are not counted again"
  );
  assert.equal(messages.scope?.meta, resolved.meta);
});

test("a resolved scope of another instance, or given with a scope or campaignId, is refused before any request", async () => {
  const other = createOutbound({
    adapter: memory({ data: world(6, 5), workspaceId: "other" }),
  });

  const foreign = await resolveScope(other, { tag: "even" });
  const { outbound: mine } = instance();
  const own = await resolveScope(mine, { tag: "even" });

  for (const [options, message] of [
    [
      { resolved: foreign },
      /for this instance \(memory:agency\), not one of memory:other/u,
    ],
    [
      { resolved: {} },
      /for this instance \(memory:agency\), not something else/u,
    ],
    [{ resolved: own, tag: "even" }, /not a campaign scope and resolved/u],
    [{ campaignId: "c1", resolved: own }, /not campaignId and resolved/u],
  ] as const) {
    const { http, outbound } = instance();

    await assert.rejects(
      outbound.sync.run("messages", {
        ...(options as object),
        onPage: () => {},
      }),
      (error) =>
        OutboundError.is(error) &&
        error.code === "Invalid" &&
        message.test(error.message),
      JSON.stringify(Object.keys(options))
    );
    assert.equal(http.requests.length, 0);
  }
});
