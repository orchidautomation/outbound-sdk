import assert from "node:assert/strict";
import { test } from "node:test";

import { audit } from "../src/audit/index.ts";
import type { AuditEntry } from "../src/audit/index.ts";
import { budget } from "../src/budget/index.ts";
import { cache, cacheKey, memoryCacheStore } from "../src/cache/index.ts";
import {
  createOutbound,
  MemoryRateLimitStore,
  OutboundError,
} from "../src/index.ts";
import type { OutboundPlugin } from "../src/index.ts";
import { tracing } from "../src/tracing/index.ts";
import type { SpanAttributes } from "../src/tracing/index.ts";
import { createClock } from "./helpers/clock.ts";
import { createFetch, json, KEY, testAdapter } from "./helpers/http.ts";
import type { Handler } from "./helpers/http.ts";

const twoPages: Handler = (request) =>
  new URL(request.url).searchParams.get("offset") === "0"
    ? json({ items: [{ id: "c1" }, { id: "c2" }], next: 2 })
    : json({ items: [{ id: "c3" }] });

const rejection = async (promise: Promise<unknown>): Promise<unknown> => {
  try {
    await promise;

    return undefined;
  } catch (error) {
    return error;
  }
};

const setup = <const Plugins extends readonly OutboundPlugin[]>(
  plugins: Plugins,
  handler: Handler = twoPages
) => {
  const clock = createClock();
  const http = createFetch(handler);

  const outbound = createOutbound({
    adapter: testAdapter(),
    fetch: http.fetch,
    plugins,
    rateLimitStore: new MemoryRateLimitStore(),
    runtime: clock.runtime,
    share: 1,
  });

  return { clock, http, outbound };
};

test("cache serves a repeat read without a request, and keeps the original fetch time", async () => {
  let now = Date.UTC(2026, 9, 5, 12);
  const { clock, http, outbound } = setup([cache({ now: () => now, ttl: 60 })]);
  const first = await clock.settle(outbound.campaigns.list());
  now += 30_000;
  const second = await clock.settle(outbound.campaigns.list());
  assert.equal(http.requests.length, 1);
  assert.deepEqual(second.items, first.items);
  assert.equal(second.meta.requests, 0);
  assert.equal(
    second.meta.fetchedAt,
    "2026-10-05T12:00:00.000Z",
    "when it was really fetched"
  );
  assert.equal(
    second.cursor,
    first.cursor,
    "the cursor is cached with the page"
  );
});

test("cache refetches after the ttl and keeps different reads apart", async () => {
  let now = 0;
  const { clock, http, outbound } = setup([cache({ now: () => now, ttl: 60 })]);
  const first = await clock.settle(outbound.campaigns.list());
  await clock.settle(outbound.campaigns.list({ cursor: first.cursor }));
  assert.equal(http.requests.length, 2, "another page is another entry");
  await clock.settle(outbound.campaigns.list({ cursor: first.cursor }));
  assert.equal(http.requests.length, 2);
  now += 60_000;
  await clock.settle(outbound.campaigns.list());
  assert.equal(http.requests.length, 3, "an entry as old as the ttl is stale");
});

test("cache does not store a failure", async () => {
  let calls = 0;

  const { clock, http, outbound } = setup([cache({ ttl: 60 })], () => {
    calls += 1;

    return calls === 1 ? json({}, 404) : json({ items: [{ id: "c1" }] });
  });

  await assert.rejects(
    async () => await clock.settle(outbound.campaigns.list())
  );
  assert.equal((await clock.settle(outbound.campaigns.list())).items.length, 1);
  assert.equal(http.requests.length, 2);
});

test("cache can be limited to some operations, and a ttl of 0 turns it off", async () => {
  const only = setup([cache({ only: ["campaigns.get"], ttl: 60 })], () =>
    json({ id: "c1", items: [{ id: "c1" }] })
  );

  await only.clock.settle(only.outbound.campaigns.list());
  await only.clock.settle(only.outbound.campaigns.list());
  await only.clock.settle(only.outbound.campaigns.get("c1"));
  await only.clock.settle(only.outbound.campaigns.get("c1"));
  assert.equal(only.http.requests.length, 3, "two lists, one get");

  const off = setup([cache({ ttl: 0 })]);
  await off.clock.settle(off.outbound.campaigns.list());
  await off.clock.settle(off.outbound.campaigns.list());
  assert.equal(off.http.requests.length, 2);
});

test("cache uses the store it is given, keyed per credential and operation", async () => {
  const store = memoryCacheStore(2);
  const { clock, outbound } = setup([cache({ store, ttl: 60 })]);
  await clock.settle(outbound.campaigns.list());

  const key = cacheKey(
    { provider: "testvendor", workspaceId: "default" },
    {
      kind: "campaigns.list",
      query: { limit: undefined, next: undefined, status: undefined },
    }
  );

  assert.equal((await store.get(key))?.output.items.length, 2);
  assert.notEqual(
    key,
    cacheKey(
      { provider: "testvendor", workspaceId: "other" },
      { kind: "campaigns.list", query: {} }
    )
  );
  await store.delete(key);
  assert.equal(await store.get(key), undefined);
});

test("the memory cache store drops its oldest entry when full", async () => {
  const store = memoryCacheStore(2);

  const entry = {
    output: { evidence: "exact" as const, items: [] },
    storedAt: 0,
  };

  await store.set("a", entry, 1000);
  await store.set("b", entry, 1000);
  await store.set("c", entry, 1000);
  assert.equal(await store.get("a"), undefined);
  assert.ok(await store.get("b"));
  assert.ok(await store.get("c"));
});

test("a per-call budget stops a walk that would spend too many requests", async () => {
  const { clock, http, outbound } = setup(
    [budget({ maxRequests: 2, per: "call" })],
    (request) =>
      json({
        items: [{ id: `c${new URL(request.url).searchParams.get("offset")}` }],
        next: Number(new URL(request.url).searchParams.get("offset")) + 1,
      })
  );

  const error = await rejection(
    clock.settle(outbound.campaigns.listAll().toArray())
  );

  assert.ok(OutboundError.is(error));
  assert.equal(error.code, "RateLimited");
  assert.match(error.message, /used its budget of 2 requests/u);
  assert.match(error.message, /Raise budget\(\)'s maxRequests/u);
  assert.equal(error.limit, "call");
  assert.equal(error.permanent, true);
  assert.equal(http.requests.length, 2);

  // A new call gets a fresh allowance.
  assert.equal((await clock.settle(outbound.campaigns.list())).items.length, 1);
});

test("a per-run budget counts across calls until it is reset", async () => {
  const { clock, http, outbound } = setup(
    [budget({ maxRequests: 3, per: "run" })],
    () => json({ items: [{ id: "c1" }] })
  );

  await clock.settle(outbound.campaigns.list());
  await clock.settle(outbound.campaigns.list());
  assert.equal(outbound.requestBudget.used(), 2);
  assert.equal(outbound.requestBudget.remaining(), 1);
  await clock.settle(outbound.campaigns.list());
  await assert.rejects(
    async () => await clock.settle(outbound.campaigns.list()),
    (error) =>
      OutboundError.is(error) &&
      error.code === "RateLimited" &&
      error.limit === "run" &&
      error.permanent &&
      error.retryAfterMs === undefined &&
      /The run used its budget of 3 requests to testvendor\./u.test(
        error.message
      ) &&
      /requestBudget\.reset\(\)/u.test(error.message)
  );
  assert.equal(
    http.requests.length,
    3,
    "the fourth call never reached the network"
  );
  outbound.requestBudget.reset();
  assert.equal(outbound.requestBudget.used(), 0);
  await clock.settle(outbound.campaigns.list());
  assert.equal(http.requests.length, 4);
});

test("a run budget that runs out part way through a walk stops it as a run cap", async () => {
  const { clock, http, outbound } = setup([
    budget({ maxRequests: 1, per: "run" }),
  ]);

  const error = await rejection(
    clock.settle(outbound.campaigns.listAll().toArray())
  );

  assert.ok(OutboundError.is(error));
  assert.equal(error.limit, "run");
  assert.equal(error.permanent, true);
  assert.match(error.message, /The run used its budget of 1 request /u);
  assert.equal(http.requests.length, 1, "the second page was never asked for");
});

test("a retry loop that follows error.permanent stops at a spent run budget", async () => {
  const { clock, http, outbound } = setup(
    [budget({ maxRequests: 1, per: "run" })],
    () => json({ items: [{ id: "c1" }] })
  );

  await clock.settle(outbound.campaigns.list());
  let attempts = 0;

  // The loop the retries page describes: try again while the error is not permanent.
  for (;;) {
    attempts += 1;
    // oxlint-disable-next-line no-await-in-loop -- the loop under test is sequential.
    const error = await rejection(clock.settle(outbound.campaigns.list()));

    if (!OutboundError.is(error) || error.permanent || attempts > 3) {
      break;
    }
  }

  assert.equal(attempts, 1, "a spent budget is not retried");
  assert.equal(http.requests.length, 1);
});

test("a run budget counts retries, because each one is a vendor request", async () => {
  let calls = 0;

  const { clock, outbound } = setup(
    [budget({ maxRequests: 5, per: "run" })],
    () => {
      calls += 1;

      return calls < 3 ? json({}, 500) : json({ items: [{ id: "c1" }] });
    }
  );

  await clock.settle(outbound.campaigns.list());
  assert.equal(outbound.requestBudget.used(), 3);
});

test("budget keeps a tighter per-call maxRequests and rejects a bad cap", async () => {
  const { clock, http, outbound } = setup(
    [budget({ maxRequests: 10, per: "call" })],
    () => json({}, 500)
  );

  await assert.rejects(
    async () => await clock.settle(outbound.campaigns.list({ maxRequests: 1 }))
  );
  assert.equal(http.requests.length, 1);
  assert.throws(
    () => budget({ maxRequests: 0 }),
    (error) => OutboundError.is(error) && error.code === "Invalid"
  );
  assert.throws(() => budget({ maxRequests: 1.5 }), OutboundError);
});

test("audit records each operation with its duration and rate cost, and nothing personal", async () => {
  const entries: AuditEntry[] = [];
  let now = Date.UTC(2026, 9, 5);

  const { clock, outbound } = setup(
    [
      audit({
        now: () => {
          now += 5;

          return now;
        },
        sink: (entry) => {
          entries.push(entry);
        },
      }),
    ],
    twoPages
  );

  await clock.settle(outbound.campaigns.listAll().toArray());
  assert.deepEqual(
    entries.map((entry) =>
      entry.type === "call"
        ? [entry.operation, entry.records, entry.requests, entry.error]
        : []
    ),
    [
      ["campaigns.list", 2, 1, null],
      ["campaigns.list", 1, 1, null],
    ]
  );
  const [first] = entries;
  assert.ok(first?.type === "call");
  assert.equal(first.provider, "testvendor");
  assert.equal(first.workspaceId, "default");
  assert.equal(first.durationMs, 5);
  assert.match(first.at, /^2026-10-05T00:00:00\.\d{3}Z$/u);
  assert.ok(!JSON.stringify(entries).includes(KEY));
});

test("audit records a failure with its error code, and can record each HTTP request", async () => {
  const entries: AuditEntry[] = [];

  const { clock, outbound } = setup(
    [
      audit({
        requests: true,
        sink: (entry) => {
          entries.push(entry);
        },
      }),
    ],
    () => json({}, 401)
  );

  await assert.rejects(
    async () => await clock.settle(outbound.campaigns.get("c1"))
  );
  const call = entries.find((entry) => entry.type === "call");
  assert.ok(call?.type === "call");
  assert.equal(call.error, "Unauthorized");
  assert.equal(call.records, null);
  const request = entries.find((entry) => entry.type === "request");
  assert.ok(request?.type === "request");
  assert.equal(request.status, 401);
  assert.equal(request.method, "GET");
  assert.equal(request.attempt, 1);
  assert.ok(!request.url.includes(KEY), "the URL is redacted");
  assert.match(request.url, /api_key=\[redacted-key\]/u);
});

test("a failing audit sink cannot fail the call", async () => {
  const throwing = setup([
    audit({
      sink: () => {
        throw new Error("disk full");
      },
    }),
  ]);

  assert.equal(
    (await throwing.clock.settle(throwing.outbound.campaigns.list())).items
      .length,
    2
  );

  const rejecting = setup([
    audit({ sink: () => Promise.reject(new Error("network down")) }),
  ]);

  assert.equal(
    (await rejecting.clock.settle(rejecting.outbound.campaigns.list())).items
      .length,
    2
  );
});

interface RecordedSpan {
  readonly name: string;
  readonly attributes: Record<string, string | number | boolean>;
  status: number | undefined;
  ended: boolean;
  readonly startTime: number | undefined;
}

const recordingTracer = () => {
  const spans: RecordedSpan[] = [];

  return {
    spans,
    tracer: {
      startSpan: (
        name: string,
        options?: { attributes?: SpanAttributes; startTime?: number }
      ) => {
        const span: RecordedSpan = {
          attributes: { ...options?.attributes },
          ended: false,
          name,
          startTime: options?.startTime,
          status: undefined,
        };

        spans.push(span);

        return {
          end: () => {
            span.ended = true;
          },
          setAttribute: (key: string, value: string | number | boolean) => {
            span.attributes[key] = value;
          },
          setStatus: (status: { code: number }) => {
            span.status = status.code;
          },
        };
      },
    },
  };
};

test("tracing emits a span per operation and per HTTP request", async () => {
  const { spans, tracer } = recordingTracer();

  const { clock, outbound } = setup(
    [tracing({ now: () => 10_000, tracer })],
    twoPages
  );

  await clock.settle(outbound.campaigns.list());
  assert.deepEqual(
    spans.map((span) => span.name),
    ["outbound.campaigns.list", "outbound.http GET"]
  );
  const [operation, request] = spans;
  assert.deepEqual(operation?.attributes, {
    "outbound.evidence": "exact",
    "outbound.operation": "campaigns.list",
    "outbound.provider": "testvendor",
    "outbound.records": 2,
    "outbound.requests": 1,
    "outbound.workspace": "default",
  });
  assert.equal(operation?.status, 1);
  assert.equal(request?.attributes["http.response.status_code"], 200);
  assert.equal(request?.attributes["http.request.method"], "GET");
  assert.ok(!String(request?.attributes["url.full"]).includes(KEY));
  assert.equal(
    request?.startTime,
    10_000,
    "the span starts when the request started"
  );
  assert.ok(spans.every((span) => span.ended));
});

test("tracing marks a failed operation and each failed request as errors", async () => {
  const { spans, tracer } = recordingTracer();
  const { clock, outbound } = setup([tracing({ tracer })], () => json({}, 503));
  await assert.rejects(
    async () => await clock.settle(outbound.campaigns.list({ retries: 1 }))
  );
  const [operation, ...requests] = spans;
  assert.equal(operation?.status, 2);
  assert.equal(operation?.attributes["outbound.error"], "Provider");
  assert.equal(operation?.attributes["outbound.requests"], 2);
  assert.equal(requests.length, 2);
  assert.deepEqual(
    requests.map((span) => [span.status, span.attributes["outbound.attempt"]]),
    [
      [2, 1],
      [2, 2],
    ]
  );
  assert.ok(spans.every((span) => span.ended));
});

test("tracing records a request that never got a response", async () => {
  const { spans, tracer } = recordingTracer();

  const { clock, outbound } = setup(
    [tracing({ tracer })],
    () => new TypeError("socket hang up")
  );

  await assert.rejects(
    async () => await clock.settle(outbound.campaigns.list({ retries: 0 }))
  );
  const request = spans.find((span) => span.name === "outbound.http GET");
  assert.equal(request?.status, 2);
  assert.equal(
    "http.response.status_code" in (request?.attributes ?? {}),
    false
  );
});

test("plugins run in the documented order: redact outermost, budget innermost", async () => {
  const entries: AuditEntry[] = [];

  const { clock, http, outbound } = setup(
    [
      cache({ ttl: 60 }),
      audit({
        sink: (entry) => {
          entries.push(entry);
        },
      }),
      budget({ maxRequests: 5, per: "run" }),
    ],
    () => json({ items: [{ id: "c1" }] })
  );

  await clock.settle(outbound.campaigns.list());
  await clock.settle(outbound.campaigns.list());
  assert.equal(http.requests.length, 1);
  assert.equal(
    entries.length,
    1,
    "a cache hit never reaches the audit or budget layers inside it"
  );
  assert.equal(outbound.requestBudget.used(), 1);
});
