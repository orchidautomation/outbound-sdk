// The plugins that keep answers: what failover counts as the vendor being
// down, the fetch time cache and failover report together, and what fixtures
// writes for two workspaces and for person keys.

import assert from "node:assert/strict";
import { mkdtempSync, readdirSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { after, test } from "node:test";

import { budget } from "../src/budget/index.ts";
import { cache, memoryCacheStore } from "../src/cache/index.ts";
import { failover } from "../src/failover/index.ts";
import { fixtureFile, fixtures } from "../src/fixtures/index.ts";
import { identity } from "../src/identity/index.ts";
import {
  createOutbound,
  MemoryRateLimitStore,
  OutboundError,
} from "../src/index.ts";
import type { LimitDeclaration, OutboundPlugin } from "../src/index.ts";
import { memory } from "../src/memory/index.ts";
import { createClock } from "./helpers/clock.ts";
import { createFetch, json, testAdapter } from "./helpers/http.ts";
import type { Handler } from "./helpers/http.ts";

const T0 = Date.UTC(2026, 9, 5, 12);
const MINUTE = 60_000;

const twoPages: Handler = (request) =>
  new URL(request.url).searchParams.get("offset") === "0"
    ? json({ items: [{ id: "c1" }], next: 1 })
    : json({ items: [{ id: "c2" }] });

interface Setup {
  readonly handler?: Handler;
  readonly limits?: LimitDeclaration;
}

// `plugins` gets the wall clock the plugins read, so a test can move it.
const setup = (
  plugins: (now: () => number) => readonly OutboundPlugin[],
  options: Setup = {}
) => {
  const clock = createClock();
  const http = createFetch(options.handler ?? twoPages);
  let now = T0;

  const outbound = createOutbound({
    adapter: testAdapter(
      options.limits === undefined ? {} : { limits: options.limits }
    ),
    fetch: http.fetch,
    plugins: plugins(() => now),
    rateLimitStore: new MemoryRateLimitStore(),
    retries: 0,
    runtime: clock.runtime,
    share: 1,
  });

  return {
    advance: (ms: number) => {
      now += ms;
    },
    clock,
    http,
    outbound,
  };
};

const rateLimited = (pattern: RegExp) => (error: unknown) =>
  OutboundError.is(error) &&
  error.code === "RateLimited" &&
  error.status === undefined &&
  pattern.test(error.message);

test("failover does not serve a stale answer for a read the budget plugin stopped", async () => {
  const { clock, http, outbound } = setup((now) => [
    failover({ now, store: memoryCacheStore() }),
    budget({ maxRequests: 1, per: "run" }),
  ]);

  await clock.settle(outbound.campaigns.list());
  await assert.rejects(
    async () => await clock.settle(outbound.campaigns.list()),
    rateLimited(/The run used its budget/u),
    "a local cap is not an outage"
  );
  assert.equal(http.requests.length, 1);
});

test("failover does not serve a stale page for a walk maxRequests stopped", async () => {
  const { clock, outbound } = setup((now) => [
    failover({ now, store: memoryCacheStore() }),
  ]);

  const all = await clock.settle(outbound.campaigns.listAll().toArray());
  assert.equal(all.length, 2, "both pages are stored");
  await assert.rejects(
    async () =>
      await clock.settle(
        outbound.campaigns.listAll({ maxRequests: 1 }).toArray()
      ),
    rateLimited(/used its budget of 1 request/u)
  );
});

test("failover does not serve a stale answer when a deadline passes on a full local rate budget", async () => {
  const { clock, http, outbound } = setup(
    (now) => [failover({ now, store: memoryCacheStore() })],
    { limits: { source: "test", windows: [{ perMs: MINUTE, requests: 1 }] } }
  );

  await clock.settle(outbound.campaigns.list());
  await assert.rejects(
    async () => await clock.settle(outbound.campaigns.list({ deadline: 5000 })),
    rateLimited(/rate budget is full/u)
  );
  assert.equal(http.requests.length, 1);
});

const upThenDown = (): { handler: Handler; fail: () => void } => {
  let down = false;

  return {
    fail: () => {
      down = true;
    },
    handler: () =>
      down ? json({}, 503) : json({ items: [{ id: "c1", name: "First" }] }),
  };
};

test("with failover outside cache, a stale answer keeps the time the vendor was asked", async () => {
  const vendor = upThenDown();

  const { advance, clock, http, outbound } = setup(
    (now) => [
      failover({ now, store: memoryCacheStore() }),
      cache({ now, ttl: 60 }),
    ],
    { handler: vendor.handler }
  );

  await clock.settle(outbound.campaigns.list());
  advance(30_000);
  const hit = await clock.settle(outbound.campaigns.list());
  assert.equal(http.requests.length, 1, "the second read was a cache hit");
  assert.equal(hit.meta.fetchedAt, "2026-10-05T12:00:00.000Z");

  vendor.fail();
  advance(MINUTE);
  const served = await clock.settle(outbound.campaigns.list());
  assert.equal(served.meta.stale, true);
  assert.equal(
    served.meta.fetchedAt,
    "2026-10-05T12:00:00.000Z",
    "not the time of the cache hit"
  );
});

test("with cache outside failover, a stale answer is not cached or restamped", async () => {
  const vendor = upThenDown();
  const store = memoryCacheStore();
  const keys: string[] = [];

  const { advance, clock, http, outbound } = setup(
    (now) => [
      cache({
        now,
        store: {
          ...store,
          set: async (key, entry, ttlMs) => {
            keys.push(key);
            await store.set(key, entry, ttlMs);
          },
        },
        ttl: 60,
      }),
      failover({ now, store: memoryCacheStore() }),
    ],
    { handler: vendor.handler }
  );

  await clock.settle(outbound.campaigns.list());
  assert.equal(keys.length, 1);
  vendor.fail();
  advance(2 * MINUTE);

  const served = await clock.settle(outbound.campaigns.list());
  assert.equal(served.meta.stale, true);
  assert.equal(served.meta.fetchedAt, "2026-10-05T12:00:00.000Z");
  assert.equal(keys.length, 1, "the stale answer was not stored");

  advance(1000);
  const again = await clock.settle(outbound.campaigns.list());
  assert.equal(http.requests.length, 3, "the vendor was tried again");
  assert.equal(again.meta.fetchedAt, "2026-10-05T12:00:00.000Z");
});

test("cache keeps the fetch time a layer inside reports, and counts the ttl from it", async () => {
  const fetchedAt = new Date(T0 - 45_000).toISOString();

  // A layer that serves an answer it fetched 45 seconds ago.
  const older: OutboundPlugin = {
    name: "older",
    wrap: async (operation, next) => ({
      ...(await next(operation)),
      fetchedAt,
    }),
  };

  const { advance, clock, http, outbound } = setup((now) => [
    cache({ now, ttl: 60 }),
    older,
  ]);

  await clock.settle(outbound.campaigns.list());
  advance(10_000);
  const hit = await clock.settle(outbound.campaigns.list());
  assert.equal(http.requests.length, 1);
  assert.equal(hit.meta.fetchedAt, fetchedAt);
  advance(10_000);
  await clock.settle(outbound.campaigns.list());
  assert.equal(
    http.requests.length,
    2,
    "65 seconds after the fetch it expired"
  );
});

const folders: string[] = [];

const folder = (): string => {
  const dir = mkdtempSync(path.join(tmpdir(), "outbound-stored-"));
  folders.push(dir);

  return dir;
};

after(() => {
  for (const dir of folders) {
    rmSync(dir, { force: true, recursive: true });
  }
});

test("fixtures keeps two workspaces of one provider in separate files", async () => {
  const dir = folder();

  const workspace = (workspaceId: string, name: string) =>
    createOutbound({
      adapter: memory({
        data: { campaigns: [{ id: "c1", name }] },
        workspaceId,
      }),
      plugins: [fixtures({ dir, scrub: false })],
    });

  await workspace("acme", "Acme launch").campaigns.list();
  await workspace("globex/eu", "Globex launch").campaigns.list();

  const files = readdirSync(dir).toSorted();
  assert.equal(files.length, 2, "neither overwrote the other");
  assert.match(
    files[0] ?? "",
    /^memory\.acme\.campaigns\.list\.[0-9a-f]{12}\.json$/u
  );
  assert.match(
    files[1] ?? "",
    /^memory\.globex_eu\.campaigns\.list\.[0-9a-f]{12}\.json$/u,
    "a label is made safe for a file name"
  );
  assert.equal(
    (await workspace("acme", "changed").campaigns.list()).items[0]?.name,
    "Acme launch",
    "each replays its own recording"
  );
  assert.equal(
    (await workspace("globex/eu", "changed").campaigns.list()).items[0]?.name,
    "Globex launch"
  );
  assert.notEqual(
    fixtureFile(
      dir,
      { provider: "memory", workspaceId: "a/b" },
      { kind: "campaigns.list", query: {} }
    ),
    fixtureFile(
      dir,
      { provider: "memory", workspaceId: "a_b" },
      { kind: "campaigns.list", query: {} }
    ),
    "two labels that look alike once made safe still differ by hash"
  );
});

test("fixtures listed before identity scrubs the person keys too", async () => {
  const dir = folder();

  const outbound = createOutbound({
    adapter: memory({
      data: {
        leads: [
          {
            email: "Jane.Doe@Northwind.example.com",
            id: "l1",
            linkedinUrl: "https://www.linkedin.com/in/jane-doe-northwind/",
          },
          { id: "https://www.linkedin.com/in/sam-roe-northwind" },
        ],
      },
    }),
    plugins: [fixtures({ dir, mode: "record" }), identity()],
  });

  const leads = (await outbound.leads.list()).items as readonly Readonly<
    Record<string, unknown>
  >[];

  assert.equal(leads[0]?.personKey, "email:person1@example.com");
  assert.deepEqual(leads[0]?.personKeys, [
    "email:person1@example.com",
    "linkedin:example-person-1",
  ]);
  assert.equal(leads[1]?.personKey, null);
  assert.deepEqual(leads[1]?.personKeys, []);
  assert.equal(
    leads[1]?.sourceId,
    "https://www.linkedin.com/in/example-person-2",
    "an id that is a profile URL is replaced like one that is an address"
  );

  const [file] = readdirSync(dir);
  const saved = readFileSync(path.join(dir, file ?? ""), "utf-8");
  assert.ok(!/jane|northwind|sam-roe/iu.test(saved), saved);
});
