import assert from "node:assert/strict";
import { test } from "node:test";

import { budget } from "../src/budget/index.ts";
import {
  createOutbound,
  MemoryRateLimitStore,
  OutboundError,
} from "../src/index.ts";
import type { OutboundOptions } from "../src/index.ts";
import { createClock } from "./helpers/clock.ts";
import { createFetch, json, testAdapter } from "./helpers/http.ts";

const setup = (options: Partial<OutboundOptions> = {}) => {
  const clock = createClock();
  const http = createFetch(() => json({}, 500));

  const outbound = createOutbound({
    adapter: testAdapter(),
    fetch: http.fetch,
    rateLimitStore: new MemoryRateLimitStore(),
    runtime: clock.runtime,
    share: 1,
    ...options,
  });

  return { clock, http, outbound };
};

const failure = async (promise: Promise<unknown>): Promise<OutboundError> => {
  try {
    await promise;
  } catch (error) {
    assert.ok(OutboundError.is(error));

    return error;
  }

  throw new Error("expected the call to fail");
};

/** Runs `body` with console.warn recorded instead of printed. */
const capturingWarnings = (body: () => void): string[] => {
  const warnings: string[] = [];
  const original = console.warn;

  console.warn = (...parts: unknown[]) => {
    warnings.push(parts.join(" "));
  };

  try {
    body();
  } finally {
    console.warn = original;
  }

  return warnings;
};

test("the deprecated maxRequests on createOutbound still caps each call, and warns once", async () => {
  let first: ReturnType<typeof setup> | undefined;

  const warnings = capturingWarnings(() => {
    first = setup({ maxRequests: 2 });
    setup({ maxRequests: 3 });
  });

  assert.equal(warnings.length, 1, "one warning per process, not per instance");
  assert.match(warnings[0] ?? "", /deprecated/u);
  assert.match(warnings[0] ?? "", /maxRequestsPerCall/u);
  assert.match(warnings[0] ?? "", /not the whole run/u);

  assert.ok(first);

  const error = await failure(
    first.clock.settle(first.outbound.campaigns.list())
  );

  assert.equal(error.limit, "call");
  assert.equal(first.http.requests.length, 2);
  assert.match(error.message, /Raise maxRequestsPerCall/u);
});

test("maxRequestsPerCall gives each call its own allowance and warns nothing", async () => {
  let built: ReturnType<typeof setup> | undefined;

  const warnings = capturingWarnings(() => {
    built = setup({ maxRequestsPerCall: 1 });
  });

  assert.deepEqual(warnings, []);
  assert.ok(built);
  const { clock, http, outbound } = built;
  await failure(clock.settle(outbound.campaigns.list()));
  await failure(clock.settle(outbound.campaigns.list()));
  assert.equal(http.requests.length, 2, "one request for each call");
});

test("setting maxRequestsPerCall and the old maxRequests together is Invalid", () => {
  assert.throws(
    () => setup({ maxRequests: 2, maxRequestsPerCall: 3 }),
    (error) =>
      OutboundError.is(error) &&
      error.code === "Invalid" &&
      /not both/u.test(error.message)
  );
});

test("budget() with no per is a total across calls", async () => {
  const clock = createClock();
  const http = createFetch(() => json({ items: [{ id: "c1" }] }));

  const outbound = createOutbound({
    adapter: testAdapter(),
    fetch: http.fetch,
    plugins: [budget({ maxRequests: 2 })],
    rateLimitStore: new MemoryRateLimitStore(),
    runtime: clock.runtime,
    share: 1,
  });

  await clock.settle(outbound.campaigns.list());
  await clock.settle(outbound.campaigns.list());
  const error = await failure(clock.settle(outbound.campaigns.list()));

  assert.equal(error.limit, "run");
  assert.equal(http.requests.length, 2);
  assert.equal(outbound.requestBudget.remaining(), 0);
});
