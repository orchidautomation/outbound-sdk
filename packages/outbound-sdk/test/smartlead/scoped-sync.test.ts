// A scoped sync of Smartlead messages reads the activity feed once (OUT-212).
// GET /campaigns/all-leads-activities takes no campaign, so reading it once
// per campaign read the whole feed each time, on its 10-per-minute lane.

import assert from "node:assert/strict";
import { test } from "node:test";

import {
  createOutbound,
  MemoryRateLimitStore,
  resolveScope,
} from "../../src/index.ts";
import type { CapabilityDeclaration, Message } from "../../src/index.ts";
import { smartlead } from "../../src/smartlead/index.ts";
import { memoryCheckpointStore, sync } from "../../src/sync/index.ts";
import { fixture } from "../helpers/fixtures.ts";
import { createFetch, json } from "../helpers/http.ts";
import { API, KEY, urlOf } from "./suite.ts";

const ACTIVE = "smartlead:client-a:2710262";
const PAUSED = "smartlead:client-a:2710100";
const FEED = `${API}/campaigns/all-leads-activities`;

const instance = (capabilities: CapabilityDeclaration = {}) => {
  const http = createFetch((request) => {
    const { pathname } = urlOf(request);

    if (pathname === `${API}/campaigns/`) {
      return json(fixture("smartlead", "listCampaigns.json"));
    }

    return pathname === FEED
      ? json(fixture("smartlead", "listAllLeadsActivities.campaigns.json"))
      : json({ message: "not found" }, 404);
  });

  const outbound = createOutbound({
    adapter: smartlead({ apiKey: KEY, capabilities, workspaceId: "client-a" }),
    fetch: http.fetch,
    plugins: [
      sync({
        checkpoints: memoryCheckpointStore(),
        now: () => Date.parse("2025-12-01T00:00:00Z"),
      }),
    ],
    rateLimitStore: new MemoryRateLimitStore(),
    retries: 0,
  });

  return { http, outbound };
};

const feedReads = (http: ReturnType<typeof instance>["http"]) =>
  http.requests.filter((request) => urlOf(request).pathname === FEED);

test("smartlead declares messages filtered by campaign here, and replies by Smartlead", () => {
  const { outbound } = instance();

  assert.equal(outbound.capabilities["messages.byCampaign"], "client");
  assert.equal(outbound.capabilities["replies.byCampaign"], "server");
});

test("a scoped messages sync reads the activity feed once, not once per campaign", async () => {
  const { http, outbound } = instance();
  const resolved = await resolveScope(outbound, { campaign_name: "*" });
  const pages: [string | undefined, (string | null)[]][] = [];

  const result = await outbound.sync.run<Message>("messages", {
    onPage: (items, page) => {
      pages.push([page.campaignRef, items.map((item) => item.campaignRef)]);
    },
    resolved,
  });

  assert.deepEqual(
    resolved.campaigns.map((campaign) => campaign.ref),
    [ACTIVE, PAUSED]
  );
  assert.equal(
    feedReads(http).length,
    1,
    "one read of the feed for both campaigns"
  );
  assert.equal(
    feedReads(http).every(
      (request) => !urlOf(request).search.includes("campaign")
    ),
    true,
    "the feed is sent no campaign"
  );
  assert.equal(result.requests, 1);
  assert.deepEqual(pages, [
    [ACTIVE, [ACTIVE, ACTIVE, ACTIVE]],
    [PAUSED, [PAUSED, PAUSED]],
  ]);
  assert.equal(result.records, 5, "campaign 999 is not in the scope");
  assert.deepEqual(
    result.scope?.campaigns.map((each) => [each.campaignRef, each.records]),
    [
      [ACTIVE, 3],
      [PAUSED, 2],
    ]
  );
  assert.match(
    result.notes.join(" "),
    /cannot filter messages by campaign, so this run read them once \(1 requests\)/u
  );

  const [snapshot] = await outbound.limits();

  assert.equal(
    snapshot?.windows.find((window) => window.lane === "all-leads-activities")
      ?.used,
    1
  );
});

test("where Smartlead would filter by campaign, each campaign is read on its own", async () => {
  // Not what Smartlead declares: the grade alone decides, so the old cost shows.
  const { http, outbound } = instance({ "messages.byCampaign": "server" });
  const resolved = await resolveScope(outbound, { campaign_name: "*" });

  const result = await outbound.sync.run<Message>("messages", {
    onPage: () => {},
    resolved,
  });

  assert.equal(feedReads(http).length, 2, "the whole feed once per campaign");
  assert.equal(result.records, 5);
});

test("the next scoped run asks the feed only for what came since", async () => {
  const { http, outbound } = instance();
  const resolved = await resolveScope(outbound, { campaign_name: "*" });

  await outbound.sync.run("messages", { onPage: () => {}, resolved });
  await outbound.sync.run("messages", { onPage: () => {}, resolved });

  assert.deepEqual(
    feedReads(http).map((request) =>
      urlOf(request).searchParams.get("event_time_from")
    ),
    [null, "2025-11-30T23:55:00.000Z"]
  );
});
