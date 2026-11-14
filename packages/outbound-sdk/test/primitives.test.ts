import assert from "node:assert/strict";
import { test } from "node:test";

import {
  CAPABILITY_KEYS,
  computeRates,
  emptyCounts,
  intersectCapabilities,
  makeErrorMapper,
  makeRef,
  METRIC_DEFINITIONS,
  NO_CAPABILITIES,
  OutboundError,
  parseRef,
  redactText,
  resolveCapabilities,
  sha256Hex,
  stableId,
  sumCounts,
} from "../src/index.ts";
import type { MetricRow } from "../src/index.ts";

const row = (counts: Partial<MetricRow>): MetricRow => ({
  ...emptyCounts(),
  contentHash: null,
  date: null,
  evidence: "exact",
  provider: "memory",
  schemaVersion: 1,
  scope: "campaign",
  scopeRef: "memory:default:c1",
  stepIndex: null,
  timezone: null,
  variantKey: null,
  workspaceId: "default",
  ...counts,
});

test("sha256Hex matches the FIPS 180-4 test vectors", () => {
  assert.equal(
    sha256Hex(""),
    "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855"
  );
  assert.equal(
    sha256Hex("abc"),
    "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad"
  );
  assert.equal(
    sha256Hex("abcdbcdecdefdefgefghfghighijhijkijkljklmklmnlmnomnopnopq"),
    "248d6a61d20638b8e5c026930c3e6039a33ce45964ff2167f6ecedd419db06c1"
  );
  assert.equal(
    sha256Hex("a".repeat(1_000_000)),
    "cdc76e5c9914fb9281a1c7e284d73e67f1809a48a497200e046d39ccc7112cd0"
  );
});

test("sha256Hex hashes UTF-8, not UTF-16 code units", () => {
  // Expected value from coreutils: printf 'héllo ✓' | sha256sum
  assert.equal(
    sha256Hex("héllo ✓"),
    "5657cdef8a85a584e0e961e6f8247cf5d3f8ed21496ed6fdbcfd43a761e94245"
  );
});

test("stableId is stable and separates its parts", () => {
  assert.equal(stableId("a", "b"), stableId("a", "b"));
  assert.notEqual(stableId("ab", "c"), stableId("a", "bc"));
  assert.equal(stableId("a", null), stableId("a", undefined));
  assert.equal(stableId("x").length, 32);
});

test("an OutboundError is permanent unless it is Provider or RateLimited", () => {
  assert.equal(new OutboundError("Provider", "x").permanent, false);
  assert.equal(new OutboundError("RateLimited", "x").permanent, false);
  assert.equal(
    new OutboundError("Provider", "x", { aborted: true }).permanent,
    true
  );

  for (const code of [
    "Invalid",
    "NotFound",
    "Unauthorized",
    "Unsupported",
  ] as const) {
    assert.equal(new OutboundError(code, "x").permanent, true, code);
  }
});

test("OutboundError.is recognises an error from another copy of the package", () => {
  const foreign = Object.assign(new Error("from another bundle"), {
    [Symbol.for("outbound-sdk.OutboundError")]: true,
    code: "NotFound",
  });

  assert.equal(OutboundError.is(foreign), true);
  assert.equal(OutboundError.is(new Error("plain")), false);
  assert.equal(OutboundError.is(null), false);
  assert.equal(OutboundError.is("NotFound"), false);
  assert.ok(new OutboundError("Invalid", "x") instanceof Error);
  assert.equal(new OutboundError("Invalid", "x").name, "OutboundError");
});

test("an error message never carries a secret or an email address", () => {
  const error = new OutboundError(
    "Invalid",
    "key sk_live_abcdef for jane.doe@acme.io failed",
    {
      secrets: ["sk_live_abcdef"],
    }
  );

  assert.equal(error.message, "key [redacted-key] for [redacted-email] failed");
});

test("redactText removes URL-encoded secrets and leaves short ones alone", () => {
  assert.equal(
    redactText("https://x.test/?api_key=a%2Bb%2Fc123&q=1", ["a+b/c123"]),
    "https://x.test/?api_key=[redacted-key]&q=1"
  );
  assert.equal(
    redactText("abc", ["ab"]),
    "abc",
    "a 2-character secret would shred ordinary text"
  );
});

test("makeErrorMapper maps statuses, keeps the vendor's message and passes errors through", () => {
  const mapError = makeErrorMapper("acme", {
    secrets: ["sk_secret_123"],
    statusCodes: { 402: "Unauthorized" },
  });

  const notFound = mapError({
    body: { message: "No such campaign" },
    retryAfterMs: undefined,
    status: 404,
  });

  assert.equal(notFound.code, "NotFound");
  assert.equal(notFound.provider, "acme");
  assert.equal(notFound.message, "acme responded 404: No such campaign");
  assert.equal(
    mapError({ body: null, retryAfterMs: 5000, status: 429 }).retryAfterMs,
    5000
  );
  assert.equal(
    mapError({ body: "plan required", retryAfterMs: undefined, status: 402 })
      .code,
    "Unauthorized"
  );
  assert.equal(
    mapError({ body: { error: "x" }, retryAfterMs: undefined, status: 418 })
      .code,
    "Invalid"
  );
  assert.equal(
    mapError({ body: {}, retryAfterMs: undefined, status: 408 }).code,
    "Provider"
  );
  const original = new OutboundError("Invalid", "already mapped");
  assert.equal(mapError(original), original);
  const wrapped = mapError(new Error("socket closed with sk_secret_123"));
  assert.equal(wrapped.code, "Provider");
  assert.equal(
    wrapped.message,
    "acme request failed: socket closed with [redacted-key]"
  );
  assert.equal(
    mapError("plain string").message,
    "acme request failed: plain string"
  );
});

test("refs round-trip and keep colons in the vendor id", () => {
  assert.equal(makeRef("instantly", "client-a", 42), "instantly:client-a:42");
  assert.deepEqual(parseRef("heyreach:ws:urn:li:123"), {
    provider: "heyreach",
    sourceId: "urn:li:123",
    workspaceId: "ws",
  });
  assert.equal(parseRef("no-colons"), null);
  assert.equal(parseRef("a:b"), null);
});

test("undeclared capabilities read as unsupported", () => {
  const resolved = resolveCapabilities({ "leads.list": true });
  assert.equal(resolved["leads.list"], true);
  assert.equal(resolved["leads.get"], false);
  assert.deepEqual(resolveCapabilities(), NO_CAPABILITIES);
  assert.equal(CAPABILITY_KEYS.length, Object.keys(NO_CAPABILITIES).length);
});

test("intersecting capabilities keeps the weaker grade for every key", () => {
  const strong = resolveCapabilities({
    "campaigns.status": "server",
    "events.verify": "signature",
    "leads.list": true,
    "messages.body": "full",
    "stats.byDay": "exact",
  });

  const weak = resolveCapabilities({
    "campaigns.status": "client",
    "events.verify": "secret",
    "leads.list": false,
    "messages.body": "sampled",
    "stats.byDay": "derived",
  });

  for (const result of [
    intersectCapabilities(strong, weak),
    intersectCapabilities(weak, strong),
  ]) {
    assert.equal(result["campaigns.status"], "client");
    assert.equal(result["events.verify"], "secret");
    assert.equal(result["leads.list"], false);
    assert.equal(result["messages.body"], "sampled");
    assert.equal(result["stats.byDay"], "derived");
  }

  assert.deepEqual(intersectCapabilities(strong), strong);
});

test("reply rate is replies divided by unique leads contacted", () => {
  // Worked example: 200 emails to 80 people, 6 human replies, 2 positive, 4 bounces, 1 unsubscribe.
  const rates = computeRates(
    row({
      bounced: 4,
      contacted: 80,
      delivered: 196,
      opened: 49,
      positive: 2,
      replied: 6,
      sent: 200,
      unsubscribed: 1,
    })
  );

  assert.deepEqual(rates.replyRate, { basis: "contacted", value: 0.075 });
  assert.deepEqual(rates.positiveReplyRate, {
    basis: "contacted",
    value: 0.025,
  });
  assert.deepEqual(rates.bounceRate, { basis: "sent", value: 0.02 });
  assert.deepEqual(rates.openRate, { basis: "delivered", value: 0.25 });
  assert.deepEqual(rates.unsubscribeRate, {
    basis: "contacted",
    value: 0.0125,
  });
});

test("a rate falls back to messages sent and says so", () => {
  const rates = computeRates(row({ opened: 10, replied: 5, sent: 100 }));
  assert.deepEqual(rates.replyRate, { basis: "sent", value: 0.05 });
  assert.deepEqual(rates.openRate, { basis: "sent", value: 0.1 });
});

test("a rate is null when a count is missing or the base is zero, never 0", () => {
  const none = { basis: null, value: null };
  assert.deepEqual(computeRates(row({ sent: 100 })).replyRate, none);
  assert.deepEqual(computeRates(row({ replied: 3 })).replyRate, none);
  assert.deepEqual(computeRates(row({ replied: 0, sent: 0 })).replyRate, none);
  assert.deepEqual(
    computeRates(row({ sent: 100 })).openRate,
    none,
    "open tracking off"
  );
  assert.deepEqual(computeRates(row({ replied: 0, sent: 50 })).replyRate, {
    basis: "sent",
    value: 0,
  });
});

test("LinkedIn acceptance rate uses its own counts", () => {
  const rates = computeRates(
    row({ connectionsAccepted: 12, connectionsSent: 40 })
  );

  assert.deepEqual(rates.acceptanceRate, {
    basis: "connectionsSent",
    value: 0.3,
  });
  assert.equal(rates.bounceRate.value, null);
});

test("sumCounts adds what is reported and keeps the rest null", () => {
  const total = sumCounts([
    { ...emptyCounts(), replied: 2, sent: 10 },
    { ...emptyCounts(), opened: 4, sent: 5 },
    emptyCounts(),
  ]);

  assert.equal(total.sent, 15);
  assert.equal(total.replied, 2);
  assert.equal(total.opened, 4);
  assert.equal(total.bounced, null);
  assert.deepEqual(sumCounts([]), emptyCounts());
});

test("every metric has a written definition", () => {
  for (const [name, definition] of Object.entries(METRIC_DEFINITIONS)) {
    assert.ok(definition.name.length > 0, name);
    assert.ok(definition.description.length > 20, name);
  }

  assert.deepEqual(
    Object.keys(computeRates(row({}))).toSorted(),
    Object.keys(METRIC_DEFINITIONS).toSorted()
  );
});
