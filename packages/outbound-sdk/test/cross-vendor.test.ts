import assert from "node:assert/strict";
import { test } from "node:test";

import { combine } from "../src/combine/index.ts";
import { createOutbound, MemoryRateLimitStore } from "../src/index.ts";
import { parse, webhookProviders } from "../src/webhooks/index.ts";
import { fixtureHandler } from "./helpers/adapter-suite.ts";
import { createClock } from "./helpers/clock.ts";
import { fixtureText } from "./helpers/fixtures.ts";
import { createFetch } from "./helpers/http.ts";
import { suite as heyreach } from "./heyreach/suite.ts";
import { suite as instantly } from "./instantly/suite.ts";
import { suite as smartlead } from "./smartlead/suite.ts";

const suites = [instantly, smartlead, heyreach];

const combined = () => {
  const clock = createClock();
  const unrouted: string[] = [];
  const http = createFetch(fixtureHandler(suites, unrouted));

  const outbound = createOutbound({
    adapter: combine(suites.map((suite) => suite.make())),
    fetch: http.fetch,
    rateLimitStore: new MemoryRateLimitStore(),
    runtime: clock.runtime,
    share: 1,
  });

  return { clock, http, outbound, unrouted };
};

test("all three vendors behind one instance list their campaigns in one stream", async () => {
  const { clock, outbound, unrouted } = combined();
  const campaigns = await clock.settle(outbound.campaigns.listAll().toArray());

  const expected = suites.reduce(
    (sum, suite) => sum + (suite.totals.campaigns ?? 0),
    0
  );

  assert.equal(campaigns.length, expected);
  assert.equal(
    new Set(campaigns.map((campaign) => campaign.ref)).size,
    expected,
    "refs never collide across vendors"
  );
  assert.deepEqual(
    [...new Set(campaigns.map((campaign) => campaign.provider))],
    ["instantly", "smartlead", "heyreach"]
  );
  assert.deepEqual(
    [...new Set(campaigns.map((campaign) => campaign.channel))].toSorted(),
    ["email", "linkedin"]
  );
  assert.deepEqual(unrouted, []);
});

test("the combined instance promises only what Instantly, Smartlead and HeyReach all do", () => {
  const { outbound } = combined();
  const { capabilities } = outbound;
  assert.equal(
    capabilities["leads.list"],
    false,
    "HeyReach has no list of every lead"
  );
  assert.equal(capabilities["leads.byCampaign"], true);
  assert.equal(
    capabilities["replies.list"],
    false,
    "HeyReach lists no replies"
  );
  assert.equal(capabilities["senders.list"], true);
  assert.equal(capabilities.sequence, true);
  assert.equal(capabilities["stats.workspace"], "exact");
  assert.equal(
    capabilities["campaigns.status"],
    "client",
    "Smartlead filters status on our side"
  );
  assert.equal(capabilities["events.verify"], "secret", "only Smartlead signs");
  assert.equal(outbound.maturity, "unverified");
});

test("workspace stats come back one row per vendor, and each vendor keeps its own rate budget", async () => {
  const { clock, http, outbound, unrouted } = combined();
  const stats = await clock.settle(outbound.stats());
  assert.deepEqual(
    stats.rows.map((row) => row.provider),
    ["instantly", "smartlead", "heyreach"]
  );
  const linkedinRow = stats.rows.find((row) => row.provider === "heyreach");
  assert.ok(
    (linkedinRow?.connectionsSent ?? 0) > 0,
    "LinkedIn counts are kept apart from email counts"
  );
  assert.equal(
    linkedinRow?.bounced,
    null,
    "an email-only count stays null for LinkedIn"
  );
  assert.deepEqual(unrouted, []);

  const snapshots = await outbound.limits();
  assert.deepEqual(
    snapshots.map((snapshot) => snapshot.provider),
    ["instantly", "smartlead", "heyreach"]
  );
  assert.ok(
    snapshots.every((snapshot) => (snapshot.windows[0]?.used ?? 0) >= 1)
  );

  const origins = new Set(
    http.requests.map((request) => new URL(request.url).origin)
  );

  assert.equal(origins.size, 3);
});

test("a campaign is read from the vendor that owns it", async () => {
  const { clock, http, outbound } = combined();

  const campaign = await clock.settle(
    outbound.campaigns.get(`heyreach:client-a:${heyreach.ids.campaign}`)
  );

  assert.equal(campaign.provider, "heyreach");
  assert.equal(campaign.channel, "linkedin");
  assert.equal(new URL(http.requests[0]?.url ?? "").origin, heyreach.origin);
  assert.equal(http.requests.length, 1, "the other two vendors were not asked");
});

test("webhook auto-detection never hands one vendor's payload to another vendor's parser", async () => {
  assert.deepEqual(webhookProviders(), ["heyreach", "instantly", "smartlead"]);

  for (const suite of suites) {
    for (const [file, type] of Object.entries(suite.webhooks)) {
      const request = new Request("https://app.example.com/hooks/outbound", {
        body: fixtureText(suite.provider, file),
        headers: { "content-type": "application/json" },
        method: "POST",
      });

      const events = await parse(request);
      assert.ok(events.length > 0, `${suite.provider}/${file}`);

      for (const event of events) {
        assert.equal(
          event.provider,
          suite.provider,
          `${file} was claimed by ${event.provider}`
        );
        assert.equal(event.type, type, `${suite.provider}/${file}`);
      }
    }
  }
});
