// hot_leads under the redact plugin, the MCP default (OUT-111). Instantly
// names a reply's lead by address, and redact masks addresses, so a reply's
// lead past max_leads cannot be looked up at the vendor. The search would
// quietly find nothing; instead it says so and marks the answer partial. Each
// person keeps one masked token (OUT-122), so replies still match their leads.

import assert from "node:assert/strict";
import { test } from "node:test";

import { createOutbound, MemoryRateLimitStore } from "../../src/index.ts";
import type { OutboundPlugin } from "../../src/index.ts";
import { insights } from "../../src/insights/index.ts";
import { redact } from "../../src/redact/index.ts";
import type { RedactOptions } from "../../src/redact/index.ts";
import { fixtureHandler } from "../helpers/adapter-suite.ts";
import { createClock } from "../helpers/clock.ts";
import { fixture } from "../helpers/fixtures.ts";
import { createFetch, json } from "../helpers/http.ts";
import { suite as instantly } from "../instantly/suite.ts";

const NOW = Date.parse("2026-11-16T12:00:00.000Z");

const PAST_CAP =
  "The redact plugin masks email addresses, which a reply can name its lead by, so leads past max_leads that replied were not looked for.";

const AUTO_CHECK =
  "The redact plugin masks email addresses, which a reply can name its lead by, so replies were not matched to leads to tell automatic replies from people.";

const repliers = (
  fixture("instantly", "listLeadsByEmail.repliers.json") as {
    items: { email: string }[];
  }
).items;

const [received] = (
  fixture("instantly", "listReplies.sameLead.json") as { items: object[] }
).items;

// The live shape: the lead listing stops at max_leads on one lead that
// replied, and another lead marked Interested, who replied three days ago, is
// past the cap and found only through its reply.
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
        next_starting_after: "x",
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

  const run = () =>
    clock.settle(outbound.insights.hotLeads({ max_leads: 1 }, { now: NOW }));

  const lookups = () =>
    http.requests.flatMap((request) => {
      const body = request.body === undefined ? {} : JSON.parse(request.body);

      return body.contacts ?? [];
    });

  return { lookups, run, unrouted };
};

test("hot_leads without redact finds the replied lead past max_leads", async () => {
  const { lookups, run, unrouted } = build([]);
  const result = await run();

  assert.deepEqual(unrouted, []);
  assert.deepEqual(lookups(), ["person16@example.com"]);
  assert.equal(result.data.totals.fromReplies, 1);
  assert.deepEqual(result.data.leads.map((lead) => lead.email).toSorted(), [
    "person16@example.com",
    "person31@example.com",
  ]);
  assert.ok(!result.meta.notes.includes(PAST_CAP));
});

const masking: readonly [string, RedactOptions][] = [
  ["mask", {}],
  ["hash", { strategy: "hash" }],
];

for (const [strategy, options] of masking) {
  test(`hot_leads under a ${strategy} redact says it did not look past max_leads, instead of dropping the replied lead silently`, async () => {
    const { lookups, run, unrouted } = build([redact(options)]);
    const result = await run();

    assert.deepEqual(unrouted, []);
    assert.deepEqual(lookups(), [], "no lead is looked up by a masked address");
    assert.equal(result.data.totals.fromReplies, 0);
    assert.equal(result.data.totals.moreLeadsExist, true);
    assert.equal(result.meta.complete, false);
    assert.ok(
      result.meta.notes.includes(PAST_CAP),
      result.meta.notes.join(" ")
    );
    assert.ok(
      result.data.leads.every((lead) => lead.email !== "person16@example.com"),
      "the address stays masked"
    );
  });
}

for (const [strategy, options] of masking) {
  test(`hot_leads under a ${strategy} redact still tells automatic replies from people`, async () => {
    const { run } = build([redact(options)]);
    const result = await run();

    assert.ok(
      !result.meta.notes.includes(AUTO_CHECK),
      result.meta.notes.join(" ")
    );
  });
}
