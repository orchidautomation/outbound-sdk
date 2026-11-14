// An error's cause is kept for debugging, and loggers print it. It must hold
// no API key and no email address.

import assert from "node:assert/strict";
import { test } from "node:test";
import { inspect } from "node:util";

import { createOutbound, OutboundError } from "../src/index.ts";
import { smartlead } from "../src/smartlead/index.ts";
import { createFetch, json, KEY, testAdapter } from "./helpers/http.ts";

const failure = async (action: () => unknown): Promise<OutboundError> => {
  try {
    await action();
  } catch (error) {
    assert.ok(OutboundError.is(error), String(error));

    return error;
  }

  throw new Error("expected the call to fail");
};

const assertClean = (error: OutboundError, secret: string): void => {
  // What console.error, Sentry and most loggers print: the whole cause chain.
  const printed = inspect(error, { depth: 12 });
  assert.ok(!printed.includes(secret), "the key is nowhere in the error");
  assert.ok(!/@example\.com/u.test(printed), "no email address either");
  assert.ok(!JSON.stringify(error.cause ?? null).includes(secret));
};

test("a vendor error body is kept on cause with the key and email addresses removed", async () => {
  const http = createFetch(() =>
    json(
      {
        "person9@example.com": "taken",
        detail: [{ field: "email", value: "Person1@Example.com" }],
        echoed: `key ${KEY} is not valid`,
        message: "Lead person1@example.com already exists",
        nested: { deeper: { url: `https://api.vendor.test/x?api_key=${KEY}` } },
        status: 422,
      },
      422
    )
  );

  const outbound = createOutbound({
    adapter: testAdapter(),
    fetch: http.fetch,
    retries: 0,
  });

  const error = await failure(() => outbound.campaigns.get("c1"));
  assert.equal(error.code, "Invalid");
  assert.equal(error.status, 422);
  assertClean(error, KEY);

  assert.deepEqual(error.cause, {
    body: {
      "[redacted-email]": "taken",
      detail: [{ field: "email", value: "[redacted-email]" }],
      echoed: "key [redacted-key] is not valid",
      message: "Lead [redacted-email] already exists",
      nested: {
        deeper: { url: "https://api.vendor.test/x?api_key=[redacted-key]" },
      },
      status: 422,
    },
    status: 422,
  });
});

test("a network error is kept on cause as a redacted copy, with its own cause", async () => {
  const inner = new Error(`connect ECONNREFUSED for person2@example.com`);

  const original = new TypeError(
    `fetch failed: https://api.vendor.test/campaigns?api_key=${KEY}`,
    { cause: inner }
  );

  const http = createFetch(() => original);

  const outbound = createOutbound({
    adapter: testAdapter(),
    fetch: http.fetch,
    retries: 0,
  });

  const error = await failure(() => outbound.campaigns.get("c1"));
  assert.equal(error.code, "Provider");
  assertClean(error, KEY);
  assert.ok(error.cause instanceof Error);
  assert.equal(error.cause.name, "TypeError");
  assert.equal(
    error.cause.message,
    "fetch failed: https://api.vendor.test/campaigns?api_key=[redacted-key]"
  );
  assert.ok(error.cause.cause instanceof Error);
  assert.equal(
    error.cause.cause.message,
    "connect ECONNREFUSED for [redacted-email]"
  );
  assert.notEqual(error.cause, original, "never the original object");
});

test("Smartlead's key, which travels in the URL, is not in a failed request's error", async () => {
  const key = "sl_live_key_0123456789abcdef";

  const http = createFetch((request) =>
    json({ error: `Invalid request to ${request.url}` }, 400)
  );

  const outbound = createOutbound({
    adapter: smartlead({ apiKey: key }),
    fetch: http.fetch,
    retries: 0,
  });

  const error = await failure(() => outbound.campaigns.list());
  assert.ok(http.requests[0]?.url.includes(key), "the key was in the URL");
  assertClean(error, key);
});

test("an odd cause is kept as plain data: no functions, no cycles, undefined dropped", () => {
  const cycle: { self?: object; name: string } = { name: "loop" };
  cycle.self = cycle;

  const error = new OutboundError("Provider", "boom", {
    cause: {
      big: 10n,
      cycle,
      fn: () => "person3@example.com",
      missing: undefined,
      nothing: null,
      ok: true,
      thrown: new RangeError("bad person4@example.com"),
    },
    secrets: [KEY],
  });

  const cause = error.cause as Record<string, unknown>;
  assert.equal(cause.big, "10");
  assert.equal(cause.nothing, null);
  assert.equal(cause.ok, true);
  assert.equal(cause.thrown, "RangeError: bad [redacted-email]");
  assert.ok(!("missing" in cause));
  assert.equal(typeof cause.fn, "string");
  assert.ok(!String(cause.fn).includes("@example.com"));
  assert.ok(JSON.stringify(cause).includes("[truncated]"), "a cycle ends");
  assert.equal(new OutboundError("Invalid", "x").cause, undefined);
  assert.equal(
    new OutboundError("Invalid", "x", { cause: "a@b.co" }).cause,
    "[redacted-email]"
  );
  assert.equal(new OutboundError("Invalid", "x", { cause: 7 }).cause, 7);
  assert.equal(new OutboundError("Invalid", "x", { cause: null }).cause, null);
});

test("an OutboundError kept as a cause stays the same object", () => {
  const inner = new OutboundError("NotFound", "gone");
  const outer = new OutboundError("Provider", "wrapped", { cause: inner });
  assert.equal(outer.cause, inner);
});

test("a long chain of causes is cut, not followed forever", () => {
  let chain = new Error("root");

  for (let index = 0; index < 20; index += 1) {
    chain = new Error(`level ${index}`, { cause: chain });
  }

  const error = new OutboundError("Provider", "deep", { cause: chain });
  let depth = 0;

  for (let at: unknown = error.cause; at instanceof Error; at = at.cause) {
    depth += 1;
  }

  assert.ok(depth > 1 && depth < 20, `chain kept to ${depth} levels`);
});
