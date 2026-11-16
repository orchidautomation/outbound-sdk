// hot_leads under the redact plugin, the MCP default (OUT-111, OUT-113).
// Instantly names a reply's lead by address, and redact masks addresses, so
// under the default `mask` every reply names the same masked ref and nothing
// links a reply to its lead, and under `hash` a reply's lead cannot be read
// back. Those reads say so and mark the answer partial; the leads Instantly
// labels positive are still found by its own filter.

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

const NOT_LOOKED_UP =
  "The redact plugin masks email addresses, which a reply can name its lead by, so leads that replied within recency_days and were not otherwise listed were not looked for.";

const NOT_MATCHED =
  "The redact plugin masks email addresses, which a reply can name its lead by, so replies were not matched to leads: the leads that replied within recency_days were not looked for, and automatic replies were not told from people.";

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

test("hot_leads under a masking redact says it read no replies, and still ranks the lead labelled positive", async () => {
  const { lookups, run, unrouted } = build([redact()]);
  const result = await run();

  assert.deepEqual(unrouted, []);
  assert.deepEqual(lookups(), [], "no lead is looked up by a masked address");
  assert.equal(result.data.totals.repliesRead, 0);
  assert.equal(result.data.totals.fromReplies, 0);
  assert.equal(result.meta.complete, false);
  assert.ok(
    result.meta.notes.includes(NOT_MATCHED),
    result.meta.notes.join(" ")
  );
  assert.deepEqual(
    result.data.leads.map((lead) => [lead.email, lead.interest]),
    [["[redacted]", "Interested"]]
  );
});

test("hot_leads under a hashing redact says it did not look up the lead that replied, and still matches replies", async () => {
  const { lookups, run, unrouted } = build([redact({ strategy: "hash" })]);
  const result = await run();

  assert.deepEqual(unrouted, []);
  assert.deepEqual(lookups(), [], "no lead is looked up by a hashed address");
  assert.equal(result.data.totals.repliesRead, 1);
  assert.equal(result.data.totals.fromReplies, 0);
  assert.equal(result.meta.complete, false);
  assert.ok(
    result.meta.notes.includes(NOT_LOOKED_UP),
    result.meta.notes.join(" ")
  );
  assert.ok(!result.meta.notes.includes(NOT_MATCHED));
  assert.equal(result.data.leads.length, 1);
  assert.ok(
    result.data.leads.every((lead) => lead.email !== "person31@example.com"),
    "the address stays masked"
  );
});
