import assert from "node:assert/strict";
import { test } from "node:test";

import {
  createOutbound,
  MemoryRateLimitStore,
  OutboundError,
} from "../src/index.ts";
import type { OutboundOptions, RetryEvent } from "../src/index.ts";
import { createClock } from "./helpers/clock.ts";
import {
  createFetch,
  json,
  KEY,
  sequence,
  testAdapter,
} from "./helpers/http.ts";
import type { Handler } from "./helpers/http.ts";

const page = { items: [{ id: "c1", name: "First" }] };

const setup = (handler: Handler, options: Partial<OutboundOptions> = {}) => {
  const clock = createClock();
  const http = createFetch(handler);

  const outbound = createOutbound({
    adapter: testAdapter(),
    fetch: http.fetch,
    rateLimitStore: new MemoryRateLimitStore(),
    runtime: clock.runtime,
    ...options,
  });

  return { clock, http, outbound };
};

const failure = async (promise: Promise<unknown>): Promise<OutboundError> => {
  try {
    await promise;
  } catch (error) {
    assert.ok(
      OutboundError.is(error),
      `expected an OutboundError, got ${String(error)}`
    );

    return error;
  }

  throw new Error("expected the call to fail");
};

test("returns the first answer without retrying", async () => {
  const { clock, http, outbound } = setup(sequence(json(page)));
  const result = await clock.settle(outbound.campaigns.list());
  assert.equal(result.items[0]?.name, "First");
  assert.equal(http.requests.length, 1);
  assert.equal(result.meta.requests, 1);
});

test("retries 500, 502, 503 and 504 with exponential backoff and full jitter", async () => {
  const retries: RetryEvent[] = [];

  const { clock, http, outbound } = setup(
    sequence(
      json({}, 500),
      json({}, 502),
      json({}, 503),
      json({}, 504),
      json(page)
    ),
    {
      hooks: {
        onRetry: (event) => {
          retries.push(event);
        },
      },
    }
  );

  const result = await clock.settle(outbound.campaigns.list());
  assert.equal(result.items.length, 1);
  assert.equal(http.requests.length, 5);
  // random() is 0.5, so each delay is half of min(60 s, 1 s * 2^(attempt-1)).
  assert.deepEqual(
    retries.map((event) => event.delayMs),
    [500, 1000, 2000, 4000]
  );
  assert.equal(clock.elapsed(), 7500);
});

test("caps backoff at 60 seconds", async () => {
  const retries: RetryEvent[] = [];

  const { clock, outbound } = setup(sequence(json({}, 500)), {
    hooks: {
      onRetry: (event) => {
        retries.push(event);
      },
    },
    retries: 8,
  });

  await failure(clock.settle(outbound.campaigns.list()));
  // Attempts 7 and 8 would be 64 s and 128 s uncapped; both are capped to 60 s, halved by jitter.
  assert.deepEqual(
    retries.map((event) => event.delayMs).slice(-2),
    [30_000, 30_000]
  );
});

test("gives up after the retry budget and reports a retryable Provider error", async () => {
  const { clock, http, outbound } = setup(
    sequence(json({ message: "boom" }, 503))
  );

  const error = await failure(clock.settle(outbound.campaigns.list()));
  assert.equal(error.code, "Provider");
  assert.equal(error.status, 503);
  assert.equal(error.permanent, false);
  assert.match(error.message, /responded 503: boom/u);
  assert.equal(
    http.requests.length,
    5,
    "one attempt plus the default four retries"
  );
});

test("never retries 400, 401, 403, 404 or 422", async () => {
  const expected = [
    [400, "Invalid"],
    [401, "Unauthorized"],
    [403, "Unauthorized"],
    [404, "NotFound"],
    [422, "Invalid"],
  ] as const;

  for (const [status, code] of expected) {
    const { clock, http, outbound } = setup(
      sequence(json({ error: "no" }, status))
    );

    const error = await failure(clock.settle(outbound.campaigns.list()));
    assert.equal(error.code, code, `status ${status}`);
    assert.equal(error.permanent, true);
    assert.equal(
      http.requests.length,
      1,
      `status ${status} must not be retried`
    );
  }
});

test("retries a network failure", async () => {
  const { clock, http, outbound } = setup(
    sequence(new TypeError("socket hang up"), json(page))
  );

  const result = await clock.settle(outbound.campaigns.list());
  assert.equal(result.items.length, 1);
  assert.equal(http.requests.length, 2);
});

test("retries a timed-out attempt, because every call is a read", async () => {
  const { clock, http, outbound } = setup(sequence("hang", json(page)), {
    timeout: 5000,
  });

  const result = await clock.settle(outbound.campaigns.list());
  assert.equal(result.items.length, 1);
  assert.equal(http.requests.length, 2);
  // 5 s timeout, then a 500 ms backoff.
  assert.equal(clock.elapsed(), 5500);
});

test("reports timedOut when every attempt times out", async () => {
  const { clock, outbound } = setup(sequence("hang"), {
    retries: 1,
    timeout: 1000,
  });

  const error = await failure(clock.settle(outbound.campaigns.list()));
  assert.equal(error.code, "Provider");
  assert.equal(error.timedOut, true);
  assert.match(error.message, /did not answer within 1000 ms/u);
});

test("a per-call option overrides the constructor default", async () => {
  const { clock, http, outbound } = setup(sequence(json({}, 500)), {
    retries: 4,
  });

  await failure(clock.settle(outbound.campaigns.list({ retries: 0 })));
  assert.equal(http.requests.length, 1);
});

test("accepts a retry policy with a custom backoff", async () => {
  const { clock, http, outbound } = setup(
    sequence(json({}, 500), json({}, 500), json(page))
  );

  await clock.settle(
    outbound.campaigns.list({ retries: { backoff: () => 10, max: 2 } })
  );
  assert.equal(http.requests.length, 3);
  assert.equal(clock.elapsed(), 20);
});

test("stops at once when the caller aborts, and never retries", async () => {
  const controller = new AbortController();

  const { clock, http, outbound } = setup(() => {
    controller.abort();

    return "hang";
  });

  const error = await failure(
    clock.settle(outbound.campaigns.list({ signal: controller.signal }))
  );

  assert.equal(error.aborted, true);
  assert.equal(error.permanent, true);
  assert.equal(http.requests.length, 1);
});

test("rejects immediately when the signal is already aborted", async () => {
  const { clock, http, outbound } = setup(sequence(json(page)));

  const error = await failure(
    clock.settle(outbound.campaigns.list({ signal: AbortSignal.abort() }))
  );

  assert.equal(error.aborted, true);
  assert.equal(http.requests.length, 0);
});

test("stops with timedOut when the deadline would pass before the next retry", async () => {
  const { clock, http, outbound } = setup(sequence(json({}, 500)), {
    deadline: 1200,
  });

  const error = await failure(clock.settle(outbound.campaigns.list()));
  // Attempt 1 fails, 500 ms backoff fits; attempt 2 fails, 1000 ms backoff does not.
  assert.equal(http.requests.length, 2);
  assert.equal(error.timedOut, true);
  assert.equal(error.code, "Provider");
});

test("stops a call that reaches its request budget", async () => {
  const { clock, http, outbound } = setup(sequence(json({}, 500)), {
    maxRequests: 2,
  });

  const error = await failure(clock.settle(outbound.campaigns.list()));
  assert.equal(error.code, "RateLimited");
  assert.match(error.message, /budget of 2 requests/u);
  assert.equal(http.requests.length, 2);
});

test("keeps the API key and email addresses out of errors and hooks", async () => {
  const retries: RetryEvent[] = [];

  const { clock, outbound } = setup(
    sequence(json({ message: `bad key ${KEY} for owner@customer.io` }, 500)),
    {
      hooks: {
        onRetry: (event) => {
          retries.push(event);
        },
      },
      retries: 1,
    }
  );

  const error = await failure(clock.settle(outbound.campaigns.list()));
  assert.ok(!error.message.includes(KEY), error.message);
  assert.ok(!error.message.includes("owner@customer.io"), error.message);
  assert.match(error.message, /\[redacted-key\].*\[redacted-email\]/u);
  assert.equal(retries.length, 1);
  assert.ok(!retries[0]?.url.includes(KEY), retries[0]?.url ?? "");
  assert.ok(!retries[0]?.reason.includes(KEY));
});

test("a hook that throws or rejects cannot fail the call", async () => {
  const { clock, outbound } = setup(sequence(json({}, 500), json(page)), {
    hooks: {
      onAction: () => {
        throw new Error("sync hook failure");
      },
      onRetry: () => Promise.reject(new Error("async hook failure")),
    },
  });

  const result = await clock.settle(outbound.campaigns.list());
  assert.equal(result.items.length, 1);
});

test("reports each call and each failure to the hooks", async () => {
  const actions: string[] = [];
  const errors: string[] = [];

  const { clock, outbound } = setup(sequence(json(page), json({}, 404)), {
    hooks: {
      onAction: (event) => {
        actions.push(`${event.action}:${event.requests}`);
      },
      onError: (event) => {
        errors.push(`${event.action}:${event.error.message}`);
      },
    },
  });

  await clock.settle(outbound.campaigns.list());
  await failure(clock.settle(outbound.campaigns.get("missing")));
  assert.deepEqual(actions, ["campaigns.list:1"]);
  assert.equal(errors.length, 1);
  assert.match(errors[0] ?? "", /^campaigns\.get:testvendor responded 404/u);
});

test("sends JSON headers and the adapter's credential", async () => {
  const { clock, http, outbound } = setup(sequence(json(page)));
  await clock.settle(outbound.campaigns.list());
  assert.equal(http.requests[0]?.headers.accept, "application/json");
  assert.equal(http.requests[0]?.headers.authorization, `Bearer ${KEY}`);
});

test("reads an empty body as null and a non-JSON body as text", async () => {
  const { clock, outbound } = setup(
    sequence(
      new Response("<html>bad gateway</html>", { status: 502 }),
      json(page)
    )
  );

  const result = await clock.settle(outbound.campaigns.list({ retries: 1 }));
  assert.equal(result.items.length, 1);
});
