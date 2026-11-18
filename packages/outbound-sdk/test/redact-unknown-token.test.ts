// An unknown redacted token, from another session or process, is refused
// before any request (OUT-151): redact keeps what a token stands for only in
// memory, so it cannot be sent to the vendor, and the error says how to get
// tokens that stay the same across runs. A reply's address is masked too.

import assert from "node:assert/strict";
import { test } from "node:test";

import {
  createOutbound,
  MemoryRateLimitStore,
  OutboundError,
} from "../src/index.ts";
import { redact } from "../src/redact/index.ts";
import { fixtureHandler } from "./helpers/adapter-suite.ts";
import { createClock } from "./helpers/clock.ts";
import { createFetch } from "./helpers/http.ts";
import { suite as instantly } from "./instantly/suite.ts";

const TOKEN = "redacted:0123456789abcdef";

const workspace = () => {
  const clock = createClock();
  const unrouted: string[] = [];
  const http = createFetch(fixtureHandler([instantly], unrouted));

  const outbound = createOutbound({
    adapter: instantly.make(),
    fetch: http.fetch,
    plugins: [redact()],
    rateLimitStore: new MemoryRateLimitStore(),
    runtime: clock.runtime,
  });

  return { clock, http, outbound, unrouted };
};

const fromElsewhere = (error: unknown): boolean =>
  OutboundError.is(error) &&
  error.code === "NotFound" &&
  error.message.includes(
    `"${TOKEN}" is a redacted token from another session or process`
  ) &&
  error.message.includes("OUTBOUND_REDACT_KEY");

test("a token from another session is refused on any read, with the redact key named, before any request", async () => {
  const { clock, http, outbound } = workspace();
  const ref = `instantly:client-a:${TOKEN}`;

  await assert.rejects(clock.settle(outbound.leads.get(ref)), fromElsewhere);
  await assert.rejects(
    clock.settle(outbound.lead(ref).timeline()),
    fromElsewhere
  );
  await assert.rejects(
    clock.settle(
      outbound.replies.list({ campaignId: `instantly:client-a:${TOKEN}` })
    ),
    fromElsewhere
  );
  assert.equal(http.requests.length, 0);
});

test("under redact a reply's leadEmail is a token, and its leadRef names the lead without an address", async () => {
  const { clock, outbound, unrouted } = workspace();
  const page = await clock.settle(outbound.replies.list());

  assert.deepEqual(unrouted, []);
  assert.ok(page.items.length > 0);

  for (const reply of page.items) {
    assert.match(reply.leadEmail ?? "", /^redacted:[0-9a-f]{16}$/u);
    assert.doesNotMatch(reply.leadRef ?? "", /@/u);
  }
});
