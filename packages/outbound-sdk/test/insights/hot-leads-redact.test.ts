// hot_leads under the redact plugin, the MCP default (OUT-111, OUT-113).
// Instantly names a reply's lead by address, and redact masks addresses, so
// the reply names its lead by a token. Redact keeps, in memory, the address
// behind each token it wrote and reads the lead with the address in its
// place, so the answer ranks the same leads as without redact and still
// shows no address.

import assert from "node:assert/strict";
import { test } from "node:test";

import { createOutbound, MemoryRateLimitStore } from "../../src/index.ts";
import type { OutboundPlugin } from "../../src/index.ts";
import { insights } from "../../src/insights/index.ts";
import { redact } from "../../src/redact/index.ts";
import { fixtureHandler } from "../helpers/adapter-suite.ts";
import { createClock } from "../helpers/clock.ts";
import { fixture } from "../helpers/fixtures.ts";
import { createFetch, json } from "../helpers/http.ts";
import { suite as instantly } from "../instantly/suite.ts";

const NOW = Date.parse("2026-11-16T12:00:00.000Z");

const repliers = (
  fixture("instantly", "listLeadsByEmail.repliers.json") as {
    items: { email: string }[];
  }
).items;

const [received] = (
  fixture("instantly", "listReplies.sameLead.json") as { items: object[] }
).items;

// One lead comes back from the filter for positive labels; another, who
// replied three days ago, is found only through its reply.
const build = (plugins: readonly OutboundPlugin[]) => {
  const clock = createClock();
  const unrouted: string[] = [];
  const fixtures = fixtureHandler([instantly], unrouted);

  const http = createFetch((request, index) => {
    const url = new URL(request.url);
    const body = request.body === undefined ? {} : JSON.parse(request.body);

    if (url.pathname === "/api/v2/leads/list" && body.contacts === undefined) {
      return json({
        items: repliers.filter((lead) => lead.email === "person31@example.com"),
      });
    }

    if (url.pathname === "/api/v2/leads/list") {
      return json({
        items: repliers.filter((lead) => body.contacts.includes(lead.email)),
      });
    }

    return url.searchParams.get("email_type") === "received"
      ? json({
          items: [
            {
              ...received,
              from_address_email: "person16@example.com",
              id: "reply-hot",
              lead: "person16@example.com",
            },
          ],
        })
      : fixtures(request, index);
  });

  const outbound = createOutbound({
    adapter: instantly.make(),
    fetch: http.fetch,
    plugins: [...plugins, insights()],
    rateLimitStore: new MemoryRateLimitStore(),
    runtime: clock.runtime,
    share: 1,
  });

  const run = () => clock.settle(outbound.insights.hotLeads({}, { now: NOW }));

  const lookups = () =>
    http.requests.flatMap((request) => {
      const body = request.body === undefined ? {} : JSON.parse(request.body);

      return body.contacts ?? [];
    });

  return { lookups, run, unrouted };
};

test("hot_leads without redact finds the lead that replied and the lead labelled positive", async () => {
  const { lookups, run, unrouted } = build([]);
  const result = await run();

  assert.deepEqual(unrouted, []);
  assert.deepEqual(lookups(), ["person16@example.com"]);
  assert.equal(result.data.totals.fromReplies, 1);
  assert.deepEqual(result.data.leads.map((lead) => lead.email).toSorted(), [
    "person16@example.com",
    "person31@example.com",
  ]);
  assert.equal(result.meta.complete, true, result.meta.notes.join(" "));
});

// A test key only, so the answer carries no keyless note to tell it apart.
const KEY = "test-key-0123456789abcdef0123456789abcdef";

for (const [strategy, options] of [
  ["mask", { key: KEY }],
  ["hash", { key: KEY, strategy: "hash" }],
] as const) {
  test(`hot_leads under a ${strategy} redact looks up the lead that replied through redact, and ranks the same leads`, async () => {
    const plain = await build([]).run();
    const { lookups, run, unrouted } = build([redact(options)]);
    const result = await run();

    assert.deepEqual(unrouted, []);
    assert.deepEqual(
      lookups(),
      ["person16@example.com"],
      "redact puts the address back on the call to the vendor"
    );
    assert.deepEqual(result.data.totals, plain.data.totals);
    assert.equal(result.meta.complete, true, result.meta.notes.join(" "));
    assert.deepEqual(result.meta.notes, plain.meta.notes);
    assert.deepEqual(
      result.data.leads.map((lead) => lead.score),
      plain.data.leads.map((lead) => lead.score)
    );
    assert.doesNotMatch(
      JSON.stringify(result),
      /person16|person31|example\.com/u,
      "no address in the answer"
    );
  });
}
