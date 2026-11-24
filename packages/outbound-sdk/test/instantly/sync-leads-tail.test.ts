// Instantly lists leads in creation order (leads.createdOrder), so a sync
// of leads goes on from the end of the last walk instead of reading every
// lead again and keeping the new ones (BRA-128 item 3).

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

import { createOutbound, MemoryRateLimitStore } from "../../src/index.ts";
import { instantly } from "../../src/instantly/index.ts";
import { memory } from "../../src/memory/index.ts";
import { memoryCheckpointStore, sync } from "../../src/sync/index.ts";
import type { Checkpoint, CheckpointStore } from "../../src/sync/index.ts";
import { createClock } from "../helpers/clock.ts";
import { createFetch, json } from "../helpers/http.ts";

const [template] = (
  JSON.parse(
    readFileSync(
      new URL("../../../../fixtures/instantly/listLeads.json", import.meta.url),
      "utf-8"
    )
  ) as { items: Record<string, unknown>[] }
).items;

const PAGE = 2;

/** POST /leads/list as documented: by id ascending, a marker on the last page too, then an empty page. */
const workspace = () => {
  const leads: { id: string; created: string }[] = [];

  const add = (count: number, created: string) => {
    for (let at = 0; at < count; at += 1) {
      leads.push({
        created,
        id: `lead-${String(leads.length + 1).padStart(3, "0")}`,
      });
    }
  };

  const http = createFetch((request) => {
    const after = (
      JSON.parse(request.body ?? "{}") as { starting_after?: string }
    ).starting_after;

    const items = leads
      .filter((lead) => after === undefined || lead.id > after)
      .slice(0, PAGE);

    return json({
      items: items.map((lead) => ({
        ...template,
        email: `person${lead.id.slice(5)}@example.com`,
        id: lead.id,
        timestamp_created: lead.created,
      })),
      next_starting_after: items.at(-1)?.id ?? null,
    });
  });

  return { add, http };
};

const instance = (
  http: ReturnType<typeof createFetch>,
  checkpoints: CheckpointStore,
  now: () => number
) => {
  const clock = createClock();

  const outbound = createOutbound({
    adapter: instantly({ apiKey: "inst_key_for_client_a_0001" }),
    fetch: http.fetch,
    plugins: [sync({ checkpoints, now })],
    rateLimitStore: new MemoryRateLimitStore(),
    runtime: clock.runtime,
  });

  return { outbound, settle: clock.settle };
};

const listings = (http: ReturnType<typeof createFetch>) =>
  http.requests.filter(
    (request) => new URL(request.url).pathname === "/api/v2/leads/list"
  ).length;

test("instantly: after a full walk, a sync of leads reads on from where it ended", async () => {
  const { add, http } = workspace();
  add(5, "2026-10-01T00:00:00.000Z");
  let now = Date.UTC(2026, 9, 10);
  const store = memoryCheckpointStore();
  const saved: Checkpoint[] = [];

  const checkpoints: CheckpointStore = {
    ...store,
    set: async (key, checkpoint) => {
      saved.push(checkpoint);
      await store.set(key, checkpoint);
    },
  };

  const { outbound, settle } = instance(http, checkpoints, () => now);

  assert.equal(outbound.capabilities["leads.createdOrder"], true);

  const first = await settle(outbound.sync.run("leads", { onPage: () => {} }));

  assert.equal(first.records, 5);
  assert.equal(
    listings(http),
    4,
    "three pages and the empty one after the last marker"
  );
  const end = saved.at(-1)?.tail;

  assert.equal(typeof end, "string", "the end of the walk is kept");

  now += 3_600_000;
  http.requests.length = 0;
  const idle = await settle(outbound.sync.run("leads", { onPage: () => {} }));

  assert.equal(listings(http), 1, "one request: nothing after the end");
  assert.equal(idle.records, 0);
  assert.equal(idle.complete, true);
  assert.ok(
    idle.notes.some((note) =>
      note.includes("read on from the end of the last walk (1 requests)")
    )
  );
  assert.equal(saved.at(-1)?.tail, end, "an empty read keeps the end");

  now += 3_600_000;
  add(3, new Date(now - 60_000).toISOString());
  http.requests.length = 0;
  const ids: string[] = [];

  const fresh = await settle(
    outbound.sync.run("leads", {
      onPage: (items) => {
        ids.push(...items.map((item) => item.ref.split(":").at(-1) ?? ""));
      },
    })
  );

  assert.deepEqual(
    ids,
    ["lead-006", "lead-007", "lead-008"],
    "only the new leads"
  );
  assert.equal(fresh.records, 3);
  assert.equal(listings(http), 3, "two pages of new leads and the empty one");
  assert.notEqual(saved.at(-1)?.tail, end, "the end moves past the new leads");
});

test("instantly: a reset walks every lead again, for changes and deletions", async () => {
  const { add, http } = workspace();
  add(4, "2026-10-01T00:00:00.000Z");

  const { outbound, settle } = instance(http, memoryCheckpointStore(), () =>
    Date.UTC(2026, 9, 10)
  );

  await settle(outbound.sync.run("leads", { onPage: () => {} }));
  await outbound.sync.reset("leads");
  http.requests.length = 0;

  const again = await settle(outbound.sync.run("leads", { onPage: () => {} }));

  assert.equal(again.records, 4);
  assert.equal(listings(http), 3);
  assert.equal(
    again.notes.some((note) => note.includes("end of the last walk")),
    false
  );
});

test("instantly: a walk stopped by maxPages resumes its cursor, then keeps the end", async () => {
  const { add, http } = workspace();
  add(5, "2026-10-01T00:00:00.000Z");
  const saved: Checkpoint[] = [];
  const store = memoryCheckpointStore();

  const checkpoints: CheckpointStore = {
    ...store,
    set: async (key, checkpoint) => {
      saved.push(checkpoint);
      await store.set(key, checkpoint);
    },
  };

  const { outbound, settle } = instance(http, checkpoints, () =>
    Date.UTC(2026, 9, 10)
  );

  const part = await settle(
    outbound.sync.run("leads", { maxPages: 1, onPage: () => {} })
  );

  assert.equal(part.complete, false);
  assert.equal(saved.at(-1)?.tail, undefined, "no end until a walk finishes");

  const rest = await settle(outbound.sync.run("leads", { onPage: () => {} }));

  assert.equal(rest.resumed, true);
  assert.equal(part.records + rest.records >= 5, true);
  assert.equal(typeof saved.at(-1)?.tail, "string");
});

test("a tool whose lead listing is not in creation order keeps no end and walks every lead", async () => {
  const saved: Checkpoint[] = [];
  const store = memoryCheckpointStore();

  const checkpoints: CheckpointStore = {
    ...store,
    set: async (key, checkpoint) => {
      saved.push(checkpoint);
      await store.set(key, checkpoint);
    },
  };

  const outbound = createOutbound({
    adapter: memory({
      data: {
        leads: [{ campaignId: "c1", email: "a@example.com", id: "l1" }],
        campaigns: [{ id: "c1", name: "One" }],
      },
    }),
    plugins: [sync({ checkpoints })],
  });

  assert.equal(outbound.capabilities["leads.createdOrder"], false);
  await outbound.sync.run("leads", { onPage: () => {} });
  await outbound.sync.run("leads", { onPage: () => {} });

  assert.equal(
    saved.some((checkpoint) => checkpoint.tail !== undefined),
    false
  );
});
