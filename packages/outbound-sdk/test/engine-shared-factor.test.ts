// The slowdown after a 429 is shared through the rate-limit store when the
// store can keep it (readFactor and writeFactor), so a new process or
// serverless invocation starts slowed down right after another was
// throttled; without them each process keeps its own (BRA-128 item 5).

import assert from "node:assert/strict";
import { test } from "node:test";

import { createOutbound, MemoryRateLimitStore } from "../src/index.ts";
import type { RateLimitStore, ThrottleEvent } from "../src/index.ts";
import { createClock } from "./helpers/clock.ts";
import { createFetch, json, testAdapter } from "./helpers/http.ts";

const page = { items: [{ id: "c1" }] };

/** A store of its own per invocation, sharing only the saved factors. */
const fakeStore = (
  factors: Map<string, number>,
  writes: number[],
  shares = true
): RateLimitStore => {
  const memory = new MemoryRateLimitStore();

  const base: RateLimitStore = {
    pause: (key, until) => memory.pause(key, until),
    reserve: (key, windows, now) => memory.reserve(key, windows, now),
    usage: (key, windows, now) => memory.usage(key, windows, now),
  };

  if (!shares) {
    return base;
  }

  return {
    ...base,
    readFactor: (key) => Promise.resolve(factors.get(key)),
    writeFactor: (key, factor) => {
      writes.push(factor);
      factors.set(key, factor);

      return Promise.resolve();
    },
  };
};

/** One invocation: its own clock, fetch and store, ten requests a second declared. */
const invocation = (store: RateLimitStore, firstStatus = 200) => {
  const clock = createClock();
  const throttles: ThrottleEvent[] = [];
  let calls = 0;

  const http = createFetch(() => {
    calls += 1;

    return calls === 1 && firstStatus === 429
      ? json({ error: "slow down" }, 429, { "retry-after": "1" })
      : json(page);
  });

  const outbound = createOutbound({
    adapter: testAdapter({
      limits: { source: "test", windows: [{ perMs: 1000, requests: 10 }] },
    }),
    fetch: http.fetch,
    hooks: {
      onThrottle: (event) => {
        throttles.push(event);
      },
    },
    rateLimitStore: store,
    runtime: clock.runtime,
    share: 1,
  });

  const burst = async (count: number) => {
    await clock.settle(
      Promise.all(
        Array.from({ length: count }, () => outbound.campaigns.list())
      )
    );
  };

  return { burst, outbound, settle: clock.settle, throttles };
};

test("a 429 in one invocation slows the next one down through the store", async () => {
  const factors = new Map<string, number>();
  const writes: number[] = [];

  const throttled = invocation(fakeStore(factors, writes), 429);
  await throttled.settle(throttled.outbound.campaigns.list());

  assert.deepEqual(
    writes,
    [0.5, 0.55],
    "halved on the 429, raised on the retry's success"
  );

  const next = invocation(fakeStore(factors, writes));
  await next.burst(10);

  assert.ok(
    next.throttles.length > 0,
    "ten at once no longer fit: the next invocation starts at 0.55 of the rate"
  );
  assert.equal(next.throttles[0]?.windows[0]?.requests, 5);
});

test("without readFactor and writeFactor each invocation keeps its own slowdown", async () => {
  const factors = new Map<string, number>();
  const writes: number[] = [];

  const throttled = invocation(fakeStore(factors, writes, false), 429);
  await throttled.settle(throttled.outbound.campaigns.list());

  const next = invocation(fakeStore(factors, writes, false));
  await next.burst(10);

  assert.deepEqual(writes, []);
  assert.equal(
    next.throttles.length,
    0,
    "the next invocation starts at the full rate"
  );
});

test("a saved factor outside 0.1 to 1 is ignored", async () => {
  for (const saved of [0, 0.05, 2, Number.NaN]) {
    const factors = new Map([["", saved]]);
    const store = fakeStore(factors, []);

    const read: RateLimitStore = {
      ...store,
      readFactor: () => Promise.resolve(saved),
    };

    const next = invocation(read);

    // oxlint-disable-next-line no-await-in-loop -- one invocation per value
    await next.burst(10);

    assert.equal(next.throttles.length, 0, String(saved));
  }
});

test("successes at the full rate write nothing", async () => {
  const writes: number[] = [];
  const steady = invocation(fakeStore(new Map(), writes));

  await steady.burst(5);

  assert.deepEqual(writes, []);
});
