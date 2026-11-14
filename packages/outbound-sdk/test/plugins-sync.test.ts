import assert from "node:assert/strict";
import { test } from "node:test";

import { memoryCacheStore } from "../src/cache/index.ts";
import { failover } from "../src/failover/index.ts";
import {
  createOutbound,
  MemoryRateLimitStore,
  OutboundError,
} from "../src/index.ts";
import type { Campaign, Message, OutboundEvent } from "../src/index.ts";
import { memory } from "../src/memory/index.ts";
import type { MemoryData } from "../src/memory/index.ts";
import { reconcile } from "../src/reconcile/index.ts";
import { memoryCheckpointStore, sync } from "../src/sync/index.ts";
import { createClock } from "./helpers/clock.ts";
import { createFetch, json, testAdapter } from "./helpers/http.ts";

const message = (
  id: string,
  sentAt: string,
  direction: "in" | "out" = "out"
) => ({
  campaignId: "c1",
  direction,
  id,
  sentAt,
});

const seeded = (): MemoryData => ({
  campaigns: Array.from({ length: 5 }, (_, index) => ({ id: `c${index + 1}` })),
  messages: [
    message("m1", "2026-10-01T10:00:00.000Z"),
    message("m2", "2026-10-02T10:00:00.000Z", "in"),
    message("m3", "2026-10-03T10:00:00.000Z"),
  ],
});

test("sync walks every page, hands each to onPage, and records when it finished", async () => {
  let now = Date.UTC(2026, 9, 10);
  const checkpoints = memoryCheckpointStore();

  const outbound = createOutbound({
    adapter: memory({ data: seeded(), pageSize: 2 }),
    plugins: [sync({ checkpoints, now: () => now })],
  });

  const pages: string[][] = [];

  const first = await outbound.sync.run<Campaign>("campaigns", {
    onPage: (items) => {
      pages.push(items.map((item) => item.sourceId));
    },
  });

  assert.deepEqual(pages, [["c1", "c2"], ["c3", "c4"], ["c5"]]);
  assert.deepEqual(first, {
    collection: "campaigns",
    complete: true,
    pages: 3,
    records: 5,
    resumed: false,
    since: undefined,
  });

  now += 3_600_000;
  const second = await outbound.sync.run("campaigns", { onPage: () => {} });
  assert.equal(
    second.records,
    5,
    "campaigns cannot be filtered by date, so every run lists them all"
  );
  assert.equal(second.resumed, false);
});

test("a sync that stops early resumes on the page it was reading", async () => {
  const checkpoints = memoryCheckpointStore();

  const outbound = createOutbound({
    adapter: memory({ data: seeded(), pageSize: 2 }),
    plugins: [sync({ checkpoints })],
  });

  const seen: string[] = [];

  const onPage = (items: readonly Campaign[]) => {
    seen.push(...items.map((item) => item.sourceId));
  };

  const partial = await outbound.sync.run<Campaign>("campaigns", {
    maxPages: 1,
    onPage,
  });

  assert.equal(partial.complete, false);
  assert.deepEqual(seen, ["c1", "c2"]);

  const rest = await outbound.sync.run<Campaign>("campaigns", { onPage });
  assert.equal(rest.resumed, true);
  assert.equal(rest.complete, true);
  assert.deepEqual(
    seen,
    ["c1", "c2", "c3", "c4", "c5"],
    "nothing skipped, nothing repeated"
  );
});

test("a sync whose onPage fails keeps its checkpoint before that page, so the page is retried", async () => {
  const checkpoints = memoryCheckpointStore();

  const outbound = createOutbound({
    adapter: memory({ data: seeded(), pageSize: 2 }),
    plugins: [sync({ checkpoints })],
  });

  let calls = 0;
  await assert.rejects(
    outbound.sync.run<Campaign>("campaigns", {
      onPage: () => {
        calls += 1;

        if (calls === 2) {
          throw new Error("database is down");
        }
      },
    }),
    /database is down/u
  );
  const retried: string[] = [];

  const result = await outbound.sync.run<Campaign>("campaigns", {
    onPage: (items) => {
      retried.push(...items.map((item) => item.sourceId));
    },
  });

  assert.equal(result.resumed, true);
  assert.deepEqual(
    retried,
    ["c3", "c4", "c5"],
    "the failed page is delivered again"
  );
});

test("a dated collection asks only for records since the last run, minus an overlap", async () => {
  let now = Date.parse("2026-10-02T12:00:00.000Z");

  const outbound = createOutbound({
    adapter: memory({ data: seeded() }),
    plugins: [
      sync({
        checkpoints: memoryCheckpointStore(),
        now: () => now,
        overlapMinutes: 10,
      }),
    ],
  });

  const collected: string[] = [];

  const onPage = (items: readonly Message[]) => {
    collected.push(...items.map((item) => item.sourceId));
  };

  const first = await outbound.sync.run<Message>("messages", { onPage });
  assert.equal(first.since, undefined, "the first run has no lower bound");
  assert.deepEqual(collected, ["m1", "m2", "m3"]);

  collected.length = 0;
  now = Date.parse("2026-10-04T00:00:00.000Z");
  const second = await outbound.sync.run<Message>("messages", { onPage });
  assert.equal(
    second.since,
    "2026-10-02T11:50:00.000Z",
    "the last run's start, 10 minutes earlier"
  );
  assert.deepEqual(collected, ["m3"]);

  const scoped = await outbound.sync.run<Message>("messages", {
    campaignId: "c1",
    onPage,
  });

  assert.equal(scoped.since, undefined, "a campaign has its own checkpoint");
  await outbound.sync.reset("messages");
  collected.length = 0;
  await outbound.sync.run<Message>("messages", { onPage });
  assert.equal(collected.length, 3, "after a reset the next run starts over");
});

test("sync covers senders, leads and replies, and skips the date filter a vendor lacks", async () => {
  const outbound = createOutbound({
    adapter: memory({
      capabilities: { "leads.since": false },
      data: {
        leads: [{ createdAt: "2026-10-01T00:00:00.000Z", id: "l1" }],
        messages: [message("r1", "2026-10-01T00:00:00.000Z", "in")],
        senders: [{ id: "s1" }],
      },
    }),
    plugins: [sync({ checkpoints: memoryCheckpointStore() })],
  });

  for (const collection of ["senders", "leads", "replies"] as const) {
    await outbound.sync.run(collection, { onPage: () => {} });
    const again = await outbound.sync.run(collection, { onPage: () => {} });
    assert.equal(again.records, collection === "replies" ? 0 : 1, collection);
    assert.equal(
      again.since === undefined,
      collection !== "replies",
      collection
    );
  }
});

const refused = (error: unknown): boolean =>
  OutboundError.is(error) &&
  error.code === "Invalid" &&
  error.message ===
    'sync: "reply" is not a collection. Use one of campaigns, leads, messages, replies, senders.';

test("sync refuses a name that is not a collection, where it used to read replies", async () => {
  const store = memoryCheckpointStore();
  let pages = 0;

  const outbound = createOutbound({
    adapter: memory({
      data: { messages: [message("r1", "2026-10-01T00:00:00.000Z", "in")] },
    }),
    plugins: [sync({ checkpoints: store })],
  });

  // A caller without types, or with a cast, can pass any string.
  // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- the wrong name is the point of the test.
  const wrong = "reply" as "replies";

  await assert.rejects(
    outbound.sync.run(wrong, {
      onPage: () => {
        pages += 1;
      },
    }),
    refused
  );
  await assert.rejects(outbound.sync.reset(wrong), refused);
  assert.equal(pages, 0, "nothing was read");

  const real = await outbound.sync.run("replies", { onPage: () => {} });

  assert.equal(real.records, 1);
});

const event = (
  id: string,
  messageRef: string | null,
  occurredAt: string,
  type: OutboundEvent["type"] = "message.sent"
): OutboundEvent => ({
  campaignRef: null,
  data: {},
  id,
  leadRef: null,
  messageRef,
  occurredAt,
  provider: "memory",
  raw: null,
  schemaVersion: 1,
  senderRef: null,
  type,
  workspaceId: "default",
});

test("reconcile reports webhooks that never arrived, events with no record, and late delivery", async () => {
  const outbound = createOutbound({
    adapter: memory({ data: seeded() }),
    plugins: [reconcile()],
  });

  const report = await outbound.reconcile.events({
    events: [
      event("e1", "memory:default:m1", "2026-10-01T10:00:00.000Z"),
      {
        event: event(
          "e2",
          "memory:default:m2",
          "2026-10-02T10:00:00.000Z",
          "reply.received"
        ),
        receivedAt: "2026-10-02T10:30:00.000Z",
      },
      event("e9", "memory:default:ghost", "2026-10-02T11:00:00.000Z"),
      event("e5", null, "2026-10-02T11:00:00.000Z", "lead.unsubscribed"),
    ],
    since: "2026-10-01",
    until: "2026-10-31",
  });

  assert.equal(report.checked, 3);
  assert.equal(report.matched, 2);
  assert.deepEqual(
    report.unmatchedEvents.map((unmatched) => unmatched.id),
    ["e9"]
  );
  assert.deepEqual(
    report.missingEvents.map((missing) => missing.ref),
    ["memory:default:m3"],
    "m3 was sent but no webhook announced it"
  );
  assert.deepEqual(
    report.late.map((late) => [late.event.id, late.delayMs]),
    [["e2", 30 * 60_000]]
  );
  assert.equal(report.uncheckable, 1);
});

test("reconcile finds deleted and added records by comparing a full listing with known refs", async () => {
  const outbound = createOutbound({
    adapter: memory({ data: seeded() }),
    plugins: [reconcile()],
  });

  const report = await outbound.reconcile.deletions({
    collection: "campaigns",
    known: ["memory:default:c1", "memory:default:c2", "memory:default:gone"],
  });

  assert.deepEqual(report.deleted, ["memory:default:gone"]);
  assert.deepEqual(report.added, [
    "memory:default:c3",
    "memory:default:c4",
    "memory:default:c5",
  ]);
  assert.equal(report.listed, 5);

  const leads = await outbound.reconcile.deletions({
    collection: "leads",
    known: ["memory:default:l1"],
  });

  assert.deepEqual(leads.deleted, ["memory:default:l1"]);
  assert.equal(
    (await outbound.reconcile.deletions({ collection: "senders", known: [] }))
      .listed,
    0
  );
});

const flaky = (replies: Response[]) => {
  const clock = createClock();
  let call = 0;

  const http = createFetch(() => {
    const reply = replies[Math.min(call, replies.length - 1)];
    call += 1;

    return reply?.clone() ?? json({}, 500);
  });

  let now = Date.UTC(2026, 9, 5, 12);

  const outbound = createOutbound({
    adapter: testAdapter(),
    fetch: http.fetch,
    plugins: [failover({ now: () => now, store: memoryCacheStore() })],
    rateLimitStore: new MemoryRateLimitStore(),
    retries: 0,
    runtime: clock.runtime,
  });

  return {
    advance: (ms: number) => {
      now += ms;
    },
    clock,
    outbound,
  };
};

test("failover serves the last good answer, marked stale, when the vendor is down", async () => {
  const { advance, clock, outbound } = flaky([
    json({ items: [{ id: "c1", name: "First" }] }),
    json({}, 503),
  ]);

  const fresh = await clock.settle(outbound.campaigns.list());
  assert.equal(fresh.meta.stale, false);
  advance(3_600_000);
  const served = await clock.settle(outbound.campaigns.list());
  assert.equal(served.items[0]?.name, "First");
  assert.equal(served.meta.stale, true);
  assert.equal(
    served.meta.fetchedAt,
    "2026-10-05T12:00:00.000Z",
    "when it was really fetched"
  );
});

test("failover also covers a rate limit, but never the caller's own mistakes", async () => {
  const limited = flaky([
    json({ items: [{ id: "c1" }] }),
    json({}, 429, { "retry-after": "1" }),
  ]);

  await limited.clock.settle(limited.outbound.campaigns.list());
  assert.equal(
    (await limited.clock.settle(limited.outbound.campaigns.list())).meta.stale,
    true
  );

  for (const status of [400, 401, 404]) {
    const { clock, outbound } = flaky([
      json({ items: [{ id: "c1" }] }),
      json({}, status),
    ]);

    await clock.settle(outbound.campaigns.list());
    await assert.rejects(
      async () => await clock.settle(outbound.campaigns.list()),
      (error) => OutboundError.is(error) && error.status === status,
      `a ${status} is not hidden`
    );
  }
});

test("failover has nothing to serve for a read it never saw, or one that is too old", async () => {
  const never = flaky([json({}, 503)]);
  await assert.rejects(
    async () => await never.clock.settle(never.outbound.campaigns.list()),
    OutboundError
  );

  const old = flaky([json({ items: [{ id: "c1" }] }), json({}, 503)]);
  await old.clock.settle(old.outbound.campaigns.list());
  old.advance(8 * 24 * 3_600_000);
  await assert.rejects(
    async () => await old.clock.settle(old.outbound.campaigns.list()),
    OutboundError
  );
});
