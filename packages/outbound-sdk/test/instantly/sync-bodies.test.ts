// sync.run takes include, so a sync can carry bodies as listAll does,
// including Instantly's extra read of a truncated body, counted in requests
// (BRA-128 item 2). outbound-sdk/text exports the body helpers.

import assert from "node:assert/strict";
import { test } from "node:test";

import {
  createOutbound,
  MemoryRateLimitStore,
  OutboundError,
} from "../../src/index.ts";
import type { Message, Reply } from "../../src/index.ts";
import { memoryCheckpointStore, sync } from "../../src/sync/index.ts";
import { normalizeBody, stripQuotedHistory } from "../../src/text/index.ts";
import { fixtureHandler } from "../helpers/adapter-suite.ts";
import { createFetch } from "../helpers/http.ts";
import { CAMPAIGN, suite } from "./suite.ts";

const instance = () => {
  const http = createFetch(fixtureHandler([suite], []));

  const outbound = createOutbound({
    adapter: suite.make(),
    fetch: http.fetch,
    plugins: [sync({ checkpoints: memoryCheckpointStore() })],
    rateLimitStore: new MemoryRateLimitStore(),
    retries: 0,
  });

  return { outbound, requests: http.requests };
};

const fullReads = (requests: readonly { url: string }[]) =>
  requests.filter((request) =>
    /^\/api\/v2\/emails\/[\w-]+$/u.test(new URL(request.url).pathname)
  ).length;

for (const collection of ["messages", "replies"] as const) {
  test(`instantly: sync of ${collection} with include body carries bodies, and counts the truncated-body reads`, async () => {
    const { outbound, requests } = instance();
    const items: (Message | Reply)[] = [];

    const result = await outbound.sync.run<Message | Reply>(collection, {
      campaignId: CAMPAIGN,
      include: ["body"],
      maxPages: 1,
      onPage: (page) => {
        items.push(...page);
      },
    });

    assert.ok(items.length > 0);
    assert.ok(
      items.some((item) => item.bodyText !== null),
      "bodies are filled"
    );
    assert.ok(fullReads(requests) > 0, "a truncated body is read again");
    assert.equal(result.requests, requests.length, "every read is counted");
  });

  test(`instantly: sync of ${collection} without include leaves bodies out, with no extra read`, async () => {
    const { outbound, requests } = instance();
    const items: (Message | Reply)[] = [];

    await outbound.sync.run<Message | Reply>(collection, {
      campaignId: CAMPAIGN,
      maxPages: 1,
      onPage: (page) => {
        items.push(...page);
      },
    });

    assert.ok(items.length > 0);
    assert.equal(
      items.every((item) => item.bodyText === null && item.bodyHtml === null),
      true
    );
    assert.equal(fullReads(requests), 0);
  });
}

test("sync: include on a collection without bodies is Invalid before any request", async () => {
  const { outbound, requests } = instance();

  await assert.rejects(
    outbound.sync.run("leads", { include: ["body"], onPage: () => {} }),
    (error) =>
      OutboundError.is(error) &&
      error.code === "Invalid" &&
      error.message.includes("leads")
  );
  assert.equal(requests.length, 0);
});

test("outbound-sdk/text: normalizeBody keeps HTML and gives plain text without quoted history", () => {
  assert.deepEqual(
    normalizeBody(
      "<p>Sounds good, call me.</p><p>On Mon, Jan 5, 2026 Pat wrote:</p><p>Hi there</p>"
    ),
    {
      bodyHtml:
        "<p>Sounds good, call me.</p><p>On Mon, Jan 5, 2026 Pat wrote:</p><p>Hi there</p>",
      bodyText: "Sounds good, call me.",
    }
  );
  assert.deepEqual(normalizeBody("Plain reply"), {
    bodyHtml: null,
    bodyText: "Plain reply",
  });
});

test("outbound-sdk/text: an empty body, a body not asked for, or only quoted history gives nulls", () => {
  assert.deepEqual(normalizeBody(null), { bodyHtml: null, bodyText: null });
  assert.deepEqual(normalizeBody("   "), { bodyHtml: null, bodyText: null });
  assert.deepEqual(normalizeBody("Hello", false), {
    bodyHtml: null,
    bodyText: null,
  });
  assert.deepEqual(normalizeBody("> quoted\n> more"), {
    bodyHtml: null,
    bodyText: null,
  });
  assert.equal(
    stripQuotedHistory("Yes please\n\n-----Original Message-----\nFrom: x"),
    "Yes please"
  );
  assert.equal(stripQuotedHistory("No marker here"), "No marker here");
});
