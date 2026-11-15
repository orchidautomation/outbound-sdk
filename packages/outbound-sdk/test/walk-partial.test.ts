import assert from "node:assert/strict";
import { test } from "node:test";

import { budget } from "../src/budget/index.ts";
import {
  createOutbound,
  MemoryRateLimitStore,
  OutboundError,
} from "../src/index.ts";
import type { OutboundOptions, OutboundPlugin } from "../src/index.ts";
import { memory } from "../src/memory/index.ts";
import { createClock } from "./helpers/clock.ts";
import { createFetch, json, testAdapter } from "./helpers/http.ts";
import type { Handler } from "./helpers/http.ts";

// Five campaigns, one to a page: c0 to c4.
const onePerPage: Handler = (request) => {
  const offset = Number(new URL(request.url).searchParams.get("offset"));

  const body: { items: { id: string }[]; next?: number } = {
    items: [{ id: `c${offset}` }],
  };

  if (offset < 4) {
    body.next = offset + 1;
  }

  return json(body);
};

const vendor = (
  options: Partial<OutboundOptions> = {},
  adapter: Parameters<typeof testAdapter>[0] = {}
) => {
  const clock = createClock();
  const http = createFetch(onePerPage);

  const outbound = createOutbound({
    adapter: testAdapter(adapter),
    fetch: http.fetch,
    rateLimitStore: new MemoryRateLimitStore(),
    runtime: clock.runtime,
    share: 1,
    ...options,
  });

  return { clock, http, outbound };
};

const stopped = async (promise: Promise<unknown>): Promise<OutboundError> => {
  try {
    await promise;
  } catch (error) {
    assert.ok(OutboundError.is(error));

    return error;
  }

  throw new Error("expected the walk to stop");
};

// The last part of each record's ref: c0, c1, ...
const ids = (items: readonly unknown[]): string[] =>
  items.map((item) => (item as { ref: string }).ref.split(":").at(-1) ?? "");

test("a capped toArray() keeps the records it fetched, and the cursor resumes without a gap or a repeat", async () => {
  const { clock, http, outbound } = vendor();

  const error = await stopped(
    clock.settle(outbound.campaigns.listAll({ maxRequests: 2 }).toArray())
  );

  assert.equal(error.code, "RateLimited");
  assert.equal(error.limit, "call");
  assert.equal(error.permanent, true, "the stop is still an error");
  assert.ok(error.partial);
  assert.deepEqual(ids(error.partial.items), ["c0", "c1"]);
  assert.equal(error.partial.requests, 2);
  assert.equal(http.requests.length, 2);
  assert.ok(OutboundError.is(error.cause), "the original stop is the cause");

  const rest = await clock.settle(
    outbound.campaigns.listAll({ cursor: error.partial.cursor }).toArray()
  );

  assert.deepEqual(ids(rest), ["c2", "c3", "c4"]);
});

test("a run budget that runs out part way leaves the records in error.partial", async () => {
  const { clock, outbound } = vendor({
    plugins: [budget({ maxRequests: 3, per: "run" })],
  });

  const error = await stopped(
    clock.settle(outbound.campaigns.listAll().toArray())
  );

  assert.equal(error.limit, "run");
  assert.equal(error.partial?.items.length, 3);
  assert.equal(error.partial?.requests, 3);
});

test("a deadline that stops a walk on a full rate budget leaves the records in error.partial", async () => {
  const { clock, outbound } = vendor(
    {},
    { limits: { source: "test", windows: [{ perMs: 60_000, requests: 1 }] } }
  );

  const error = await stopped(
    clock.settle(outbound.campaigns.listAll({ deadline: 5000 }).toArray())
  );

  assert.equal(error.limit, "deadline");
  assert.equal(error.permanent, false);
  assert.equal(error.partial?.items.length, 1);
  assert.equal(error.partial?.requests, 1);
  assert.ok(error.partial?.cursor, "it can resume once the budget frees up");
});

test("a walk that fails on its first page has nothing to keep and no cursor", async () => {
  const { clock, outbound } = vendor({ maxRequestsPerCall: 1, retries: 0 });

  // One request is allowed, so a cap can only stop a later page. Fail the first instead.
  const error = await stopped(
    clock.settle(
      outbound.campaigns.listAll({ cursor: "not-a-cursor" }).toArray()
    )
  );

  assert.equal(error.code, "Invalid");
  assert.deepEqual(error.partial?.items, []);
  assert.equal(error.partial?.cursor, "not-a-cursor");
});

test("for await is unchanged: the error carries no partial, and the records already yielded stay with the caller", async () => {
  const { clock, outbound } = vendor({ maxRequestsPerCall: 2 });
  const walk = outbound.campaigns.listAll();
  const seen: string[] = [];

  const error = await stopped(
    clock.settle(
      (async () => {
        for await (const campaign of walk) {
          seen.push(campaign.ref);
        }
      })()
    )
  );

  assert.equal(error.partial, undefined);
  assert.deepEqual(ids(seen.map((ref) => ({ ref }))), ["c0", "c1"]);
  assert.ok(walk.cursor);
});

test("on the in-memory adapter, a stopped toArray() resumes from its cursor without a gap or a repeat", async () => {
  let pages = 0;

  // Stops the third page, as a cap would.
  const stopThirdPage: OutboundPlugin = {
    name: "stop-third-page",
    wrap: async (operation, next) => {
      pages += 1;

      if (pages === 3) {
        throw new OutboundError("RateLimited", "stopped", { limit: "call" });
      }

      return await next(operation);
    },
  };

  const data = {
    campaigns: Array.from({ length: 7 }, (_, index) => ({
      id: `m${index}`,
      status: "active" as const,
    })),
  };

  const outbound = createOutbound({
    adapter: memory({ data, pageSize: 2 }),
    plugins: [stopThirdPage],
  });

  const error = await stopped(outbound.campaigns.listAll().toArray());
  assert.equal(error.partial?.items.length, 4);

  const rest = await outbound.campaigns
    .listAll({ cursor: error.partial?.cursor })
    .toArray();

  const all = ids([...(error.partial?.items ?? []), ...rest]);

  assert.deepEqual(all, ["m0", "m1", "m2", "m3", "m4", "m5", "m6"]);
});
