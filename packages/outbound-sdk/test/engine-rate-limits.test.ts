import assert from "node:assert/strict";
import { test } from "node:test";

import {
  createOutbound,
  MemoryRateLimitStore,
  OutboundError,
} from "../src/index.ts";
import type {
  LimitDeclaration,
  OutboundOptions,
  ThrottleEvent,
} from "../src/index.ts";
import { createClock } from "./helpers/clock.ts";
import { createFetch, json, sequence, testAdapter } from "./helpers/http.ts";
import type { Handler, TestAdapterOptions } from "./helpers/http.ts";

const page = { items: [{ id: "c1" }] };

const perSecond = (requests: number): LimitDeclaration => ({
  source: "test",
  windows: [{ perMs: 1000, requests }],
});

interface SetupOptions {
  readonly adapter?: TestAdapterOptions;
  readonly outbound?: Partial<OutboundOptions>;
  readonly store?: MemoryRateLimitStore;
}

const setup = (handler: Handler, options: SetupOptions = {}) => {
  const clock = createClock();
  const http = createFetch(handler);
  const throttles: ThrottleEvent[] = [];
  const store = options.store ?? new MemoryRateLimitStore();

  const make = (adapter: TestAdapterOptions = {}) =>
    createOutbound({
      adapter: testAdapter({ ...options.adapter, ...adapter }),
      fetch: http.fetch,
      hooks: {
        onThrottle: (event) => {
          throttles.push(event);
        },
      },
      rateLimitStore: store,
      runtime: clock.runtime,
      share: 1,
      ...options.outbound,
    });

  return { clock, http, make, outbound: make(), throttles };
};

const failure = async (promise: Promise<unknown>): Promise<OutboundError> => {
  try {
    await promise;
  } catch (error) {
    assert.ok(OutboundError.is(error), String(error));

    return error;
  }

  throw new Error("expected the call to fail");
};

test("keeps requests inside the declared window", async () => {
  const { clock, http, outbound, throttles } = setup(sequence(json(page)), {
    adapter: { limits: perSecond(4) },
  });

  for (let call = 0; call < 10; call += 1) {
    await clock.settle(outbound.campaigns.list());
  }

  assert.equal(http.requests.length, 10);
  // Four at 0 ms, four at 1,000 ms, two at 2,000 ms.
  assert.equal(clock.elapsed(), 2000);
  assert.deepEqual(
    throttles.map((event) => [event.lane, event.waitMs]),
    [
      ["default", 1000],
      ["default", 1000],
    ]
  );
});

test("reports how long a call waited in meta.throttledMs", async () => {
  const { clock, outbound } = setup(sequence(json(page)), {
    adapter: { limits: perSecond(1) },
  });

  const first = await clock.settle(outbound.campaigns.list());
  const second = await clock.settle(outbound.campaigns.list());
  assert.equal(first.meta.throttledMs, 0);
  assert.equal(second.meta.throttledMs, 1000);
});

test("uses half of the vendor's limit by default, leaving room for other tools", async () => {
  const { clock, outbound } = setup(sequence(json(page)), {
    adapter: { limits: perSecond(4) },
    outbound: { share: undefined },
  });

  for (let call = 0; call < 4; call += 1) {
    await clock.settle(outbound.campaigns.list());
  }

  // 4 per second at a 0.5 share is 2 per second: two now, two a second later.
  assert.equal(clock.elapsed(), 1000);
});

test("a request must fit every window at once", async () => {
  const { clock, outbound } = setup(sequence(json(page)), {
    adapter: {
      limits: {
        source: "test",
        windows: [
          { perMs: 100, requests: 2 },
          { perMs: 1000, requests: 3 },
        ],
      },
    },
  });

  const times: number[] = [];

  for (let call = 0; call < 4; call += 1) {
    await clock.settle(outbound.campaigns.list());
    times.push(clock.elapsed());
  }

  assert.deepEqual(times, [0, 0, 100, 1000]);
});

test("waits for Retry-After in seconds on a 429, then succeeds", async () => {
  const { clock, http, outbound } = setup(
    sequence(json({}, 429, { "retry-after": "7" }), json(page))
  );

  await clock.settle(outbound.campaigns.list());
  assert.equal(http.requests.length, 2);
  assert.equal(clock.elapsed(), 7000);
});

test("reads Retry-After as an HTTP date", async () => {
  const { clock, outbound } = setup((_request, index) =>
    index === 0
      ? json({}, 429, {
          "retry-after": new Date(Date.UTC(2026, 0, 1, 0, 0, 12)).toUTCString(),
        })
      : json(page)
  );

  await clock.settle(outbound.campaigns.list());
  assert.equal(clock.elapsed(), 12_000);
});

test("reads the wait from the response body when there is no header", async () => {
  const { clock, outbound } = setup(
    sequence(json({ retry_after: 3 }, 429), json(page))
  );

  await clock.settle(outbound.campaigns.list());
  assert.equal(clock.elapsed(), 3000);
});

test("throws RateLimited with retryAfterMs once the retry budget is spent", async () => {
  const { clock, http, outbound } = setup(
    sequence(json({}, 429, { "retry-after": "30" })),
    {
      outbound: { retries: 2 },
    }
  );

  const error = await failure(clock.settle(outbound.campaigns.list()));
  assert.equal(error.code, "RateLimited");
  assert.equal(error.retryAfterMs, 30_000);
  assert.equal(error.status, 429);
  assert.equal(error.permanent, false, "a job queue can reschedule it");
  assert.equal(error.limit, "vendor");
  assert.equal(http.requests.length, 3);
});

test("halves the rate after a 429 and climbs back slowly", async () => {
  const { clock, outbound } = setup(
    (_request, index) =>
      index === 0 ? json({}, 429, { "retry-after": "1" }) : json(page),
    { adapter: { limits: perSecond(8) } }
  );

  await clock.settle(outbound.campaigns.list());
  const [afterLimit] = await outbound.limits();
  assert.equal(
    afterLimit?.windows[0]?.requests,
    4,
    "8 per second halved, plus one recovery step"
  );

  for (let call = 0; call < 9; call += 1) {
    await clock.settle(outbound.campaigns.list());
  }

  const [recovered] = await outbound.limits();
  assert.equal(
    recovered?.windows[0]?.requests,
    8,
    "ten successes restore the declared rate"
  );
});

test("shares one budget between instances on the same credential", async () => {
  const { clock, make } = setup(sequence(json(page)), {
    adapter: { limits: perSecond(2) },
  });

  const first = make();
  const second = make();
  await clock.settle(first.campaigns.list());
  await clock.settle(first.campaigns.list());
  assert.equal(clock.elapsed(), 0);
  await clock.settle(second.campaigns.list());
  assert.equal(
    clock.elapsed(),
    1000,
    "the second instance waited for the first one's requests"
  );
});

test("keeps separate budgets for separate credentials", async () => {
  const { clock, make } = setup(sequence(json(page)), {
    adapter: { limits: perSecond(1) },
  });

  await clock.settle(
    make({ key: "sk_test_client_a_key_000001" }).campaigns.list()
  );
  await clock.settle(
    make({ key: "sk_test_client_b_key_000002" }).campaigns.list()
  );
  assert.equal(clock.elapsed(), 0);
});

test("a lane has its own stricter cap on top of the global budget", async () => {
  const { clock, make } = setup(sequence(json(page)), {
    adapter: {
      limits: {
        lanes: { emails: [{ perMs: 1000, requests: 1 }] },
        source: "test",
        windows: [{ perMs: 1000, requests: 100 }],
      },
    },
  });

  const slow = make({ lane: "emails" });
  const fast = make();
  await clock.settle(slow.campaigns.list());
  await clock.settle(fast.campaigns.list());
  await clock.settle(fast.campaigns.list());
  assert.equal(clock.elapsed(), 0, "the default lane is not held back");
  await clock.settle(slow.campaigns.list());
  assert.equal(clock.elapsed(), 1000);
});

test("caps requests in flight per credential", async () => {
  let inFlight = 0;
  let peak = 0;

  const { clock, outbound } = setup(
    async () => {
      inFlight += 1;
      peak = Math.max(peak, inFlight);
      await new Promise((resolve) => {
        setImmediate(resolve);
      });
      inFlight -= 1;

      return json(page);
    },
    {
      adapter: {
        limits: {
          concurrency: 2,
          source: "test",
          windows: [{ perMs: 1000, requests: 100 }],
        },
      },
    }
  );

  const results = await clock.settle(
    Promise.all(Array.from({ length: 6 }, () => outbound.campaigns.list()))
  );

  assert.equal(results.length, 6);
  assert.equal(peak, 2);
});

test("pauses when the vendor's headers say the window is spent", async () => {
  const { clock, outbound } = setup(
    (_request, index) =>
      json(
        page,
        200,
        index === 0
          ? { "x-remaining": "0", "x-reset": "4" }
          : { "x-remaining": "9" }
      ),
    {
      adapter: {
        limits: {
          headers: {
            remaining: "x-remaining",
            reset: "x-reset",
            resetUnit: "seconds",
          },
          source: "test",
          windows: [{ perMs: 1000, requests: 100 }],
        },
      },
    }
  );

  await clock.settle(outbound.campaigns.list());
  assert.equal(clock.elapsed(), 0);
  await clock.settle(outbound.campaigns.list());
  assert.equal(clock.elapsed(), 4000);
});

test("fails with RateLimited instead of waiting past the deadline", async () => {
  const { clock, http, outbound } = setup(sequence(json(page)), {
    adapter: {
      limits: { source: "test", windows: [{ perMs: 60_000, requests: 1 }] },
    },
  });

  await clock.settle(outbound.campaigns.list());

  const error = await failure(
    clock.settle(outbound.campaigns.list({ deadline: 5000 }))
  );

  assert.equal(error.code, "RateLimited");
  assert.equal(error.timedOut, true);
  assert.equal(error.retryAfterMs, 60_000);
  assert.equal(error.limit, "deadline");
  assert.equal(error.permanent, false, "room frees up, so it can work later");
  assert.equal(http.requests.length, 1, "nothing was sent for the second call");
});

test("reports the live budget through limits()", async () => {
  const { clock, outbound } = setup(sequence(json(page)), {
    adapter: { limits: perSecond(10) },
  });

  await clock.settle(outbound.campaigns.list());
  await clock.settle(outbound.campaigns.list());
  const [snapshot] = await outbound.limits();
  assert.deepEqual(snapshot, {
    provider: "testvendor",
    share: 1,
    source: "test",
    windows: [{ lane: "default", perMs: 1000, requests: 10, used: 2 }],
    workspaceId: "default",
  });
});

test("an aborted call stops waiting for the budget", async () => {
  const controller = new AbortController();

  const { clock, outbound } = setup(sequence(json(page)), {
    adapter: {
      limits: { source: "test", windows: [{ perMs: 60_000, requests: 1 }] },
    },
    outbound: { hooks: { onThrottle: () => controller.abort() } },
  });

  await clock.settle(outbound.campaigns.list());

  const error = await failure(
    clock.settle(outbound.campaigns.list({ signal: controller.signal }))
  );

  assert.equal(error.aborted, true);
});

test("rejects a share outside (0, 1]", () => {
  assert.throws(
    () => createOutbound({ adapter: testAdapter(), share: 0 }),
    (error) => OutboundError.is(error) && error.code === "Invalid"
  );
  assert.throws(
    () => createOutbound({ adapter: testAdapter(), share: 1.5 }),
    OutboundError
  );
});
