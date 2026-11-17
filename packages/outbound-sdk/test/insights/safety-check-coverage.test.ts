// suppression_check and lead_collisions on an Instantly workspace shaped like
// the one the SDR manager checked (OUT-148): 24 active campaigns, a block
// list past the old 2,000-entry default and a campaign past the old 500-lead
// default. The old defaults stopped at 20 campaigns, 500 leads and 2,000
// entries and said 0 violations. A safety check now reads every campaign by
// default, and one a cap stops gives no total: it leads with what it read.

import assert from "node:assert/strict";
import { test } from "node:test";

import { createOutbound, MemoryRateLimitStore } from "../../src/index.ts";
import { insights } from "../../src/insights/index.ts";
import { fixtureHandler } from "../helpers/adapter-suite.ts";
import { createClock } from "../helpers/clock.ts";
import { fixture } from "../helpers/fixtures.ts";
import { createFetch, json } from "../helpers/http.ts";
import type { RecordedRequest } from "../helpers/http.ts";
import { suite } from "../instantly/suite.ts";

const ACTIVE = 24;
const LEADS = 30;
const BIG_CAMPAIGN = 2;
const BIG = 600;
const ENTRIES = 2500;

const first = <Item>(name: string): Item =>
  (fixture("instantly", `${name}.json`) as { items: Item[] }).items[0] as Item;

const campaign = fixture("instantly", "getCampaign.json") as Record<
  string,
  unknown
>;

const { lt_interest_status: _interest, ...lead } =
  first<Record<string, unknown>>("listLeads");

const entry = first<Record<string, unknown>>("listBlockListEntries");

const uuid = (prefix: string, index: number): string =>
  `01a1d77f-${prefix}-7a9a-9112-${String(index).padStart(12, "0")}`;

const campaigns = Array.from({ length: ACTIVE }, (_, index) => ({
  ...campaign,
  id: uuid("5e23", index),
  name: `Campaign ${index + 1}`,
  status: 1,
}));

// An address on the block list past entry 2,000.
const BLOCKED_LATE = "person2300@blocked.example";

// An address on the block list's first page.
const BLOCKED_EARLY = "person1@blocked.example";

// One person in campaigns 21 and 23, past the old 20-campaign default.
const SHARED = "person-shared@example.com";

const entries = Array.from({ length: ENTRIES }, (_, index) => ({
  ...entry,
  bl_value: `person${index + 1}@blocked.example`,
  id: uuid("5e51", index),
  is_domain: false,
}));

const leadsOf = (at: number): Record<string, unknown>[] => {
  const id = campaigns[at]?.id;
  const size = at === BIG_CAMPAIGN ? BIG : LEADS;

  return Array.from({ length: size }, (_, index) => {
    let email = `lead${index + 1}-c${at + 1}@example.com`;

    // Campaign 22's last lead is blocked by an entry past 2,000.
    if (at === 21 && index === size - 1) {
      email = BLOCKED_LATE;
    }

    // The big campaign's lead 550 is blocked by the first entry.
    if (at === BIG_CAMPAIGN && index === 549) {
      email = BLOCKED_EARLY;
    }

    if ((at === 20 || at === 22) && index === 0) {
      email = SHARED;
    }

    return {
      ...lead,
      campaign: id,
      email,
      // Not replied, so still being sent to.
      email_reply_count: 0,
      id: uuid(String(at).padStart(4, "0"), index),
      status: 1,
    };
  });
};

const leads = new Map(campaigns.map((each, at) => [each.id, leadsOf(at)]));

/** One page by Instantly's `limit` and `starting_after`. */
const page = (
  items: readonly Record<string, unknown>[],
  limit: number,
  after: unknown
) => {
  const start =
    after === null || after === undefined
      ? 0
      : items.findIndex((item) => item.id === after) + 1;

  const slice = items.slice(start, start + limit);
  const last = slice.at(-1);

  return json({
    items: slice,
    next_starting_after:
      start + limit < items.length && last !== undefined ? last.id : undefined,
  });
};

const workspace = (request: RecordedRequest): Response | undefined => {
  const url = new URL(request.url);
  const limit = Number(url.searchParams.get("limit") ?? 100);
  const after = url.searchParams.get("starting_after");

  if (url.pathname === "/api/v2/campaigns") {
    return page(campaigns, limit, after);
  }

  if (url.pathname === "/api/v2/block-lists-entries") {
    return page(entries, limit, after);
  }

  if (url.pathname === "/api/v2/leads/list") {
    const body = JSON.parse(request.body ?? "{}") as Record<string, unknown>;

    return page(
      leads.get(String(body.campaign)) ?? [],
      Number(body.limit ?? 100),
      body.starting_after
    );
  }

  return undefined;
};

const outboundOver = () => {
  const clock = createClock();
  const fromFixtures = fixtureHandler([suite]);

  const http = createFetch(
    (request, index) => workspace(request) ?? fromFixtures(request, index)
  );

  const outbound = createOutbound({
    adapter: suite.make(),
    fetch: http.fetch,
    plugins: [insights()],
    rateLimitStore: new MemoryRateLimitStore(),
    runtime: clock.runtime,
    share: 1,
  });

  return { http, outbound, settle: clock.settle };
};

// The defaults before OUT-148.
const OLD_DEFAULTS = {
  max_block_entries: 2000,
  max_campaigns: 20,
  max_leads_per_campaign: 500,
};

test("suppression_check on default input checks every campaign and finds the violations past the old caps (OUT-148)", async () => {
  const { outbound, settle } = outboundOver();
  const result = await settle(outbound.insights.suppressionCheck({}));
  const { totals } = result.data;

  assert.equal(totals.campaignsRead, ACTIVE);
  assert.equal(totals.blockEntriesRead, ENTRIES);
  assert.equal(totals.moreCampaignsExist, false);
  assert.equal(totals.campaignsWithMoreLeads, 0);
  assert.equal(totals.violations, 2);
  assert.deepEqual(
    result.data.violations.map((each) => each.email).toSorted(),
    [BLOCKED_EARLY, BLOCKED_LATE]
  );
  assert.equal(
    result.data.finding,
    "2 leads still being sent to are on the block list, in 2 campaigns of 24."
  );
  assert.equal(result.meta.complete, true, result.meta.notes.join("\n"));
});

test("suppression_check stopped by its caps gives no total and leads with what it read, never a bare 0 (OUT-148)", async () => {
  const { outbound, settle } = outboundOver();

  const result = await settle(outbound.insights.suppressionCheck(OLD_DEFAULTS));

  const { totals } = result.data;

  assert.equal(totals.violations, null);
  assert.equal(totals.violationsFound, 0);
  assert.equal(totals.moreCampaignsExist, true);
  assert.equal(totals.moreBlockEntriesExist, true);
  assert.equal(totals.campaignsWithMoreLeads, 1);
  assert.equal(result.meta.complete, false);
  assert.equal(
    result.data.finding,
    "Not a clean result. No violation was found in what was read, but the check is incomplete: it read only 20 campaigns, with more in those statuses unread (max_campaigns), the first 500 leads of 1 campaign that has more (max_leads_per_campaign) and 2,000 block list entries, with more unread (max_block_entries). To check the rest, raise max_campaigns, max_leads_per_campaign and max_block_entries."
  );
});

test("raising a suppression_check cap never lowers the violations found (OUT-148)", async () => {
  const steps = [
    OLD_DEFAULTS,
    { ...OLD_DEFAULTS, max_leads_per_campaign: 1000 },
    { ...OLD_DEFAULTS, max_campaigns: 200, max_leads_per_campaign: 1000 },
    {},
  ];

  let found = 0;

  for (const input of steps) {
    const { outbound, settle } = outboundOver();
    // oxlint-disable-next-line no-await-in-loop -- each cap is checked against the one before it.
    const result = await settle(outbound.insights.suppressionCheck(input));

    assert.ok(result.data.totals.violationsFound >= found);
    found = result.data.totals.violationsFound;
  }

  assert.equal(found, 2);
});

test("lead_collisions on default input reads every campaign and finds the person past the old 20-campaign cap (OUT-148)", async () => {
  const { outbound, settle } = outboundOver();
  const result = await settle(outbound.insights.leadCollisions({}));

  assert.equal(result.data.totals.campaignsRead, ACTIVE);
  assert.equal(result.data.totals.collisions, 1);
  assert.deepEqual(result.data.collisions[0]?.identifiers, [`email:${SHARED}`]);
  assert.equal(
    result.data.finding,
    "1 person is active in two or more of the campaigns at once, among every lead of 24 campaigns."
  );
});

test("lead_collisions stopped at the old campaign cap gives no total and says what it left unread (OUT-148)", async () => {
  const { outbound, settle } = outboundOver();

  const result = await settle(
    outbound.insights.leadCollisions({
      max_campaigns: OLD_DEFAULTS.max_campaigns,
      max_leads_per_campaign: OLD_DEFAULTS.max_leads_per_campaign,
    })
  );

  assert.equal(result.data.totals.collisions, null);
  assert.equal(result.data.totals.collisionsFound, 0);
  assert.equal(result.meta.complete, false);
  assert.match(result.data.finding, /^Not a clean result\. /u);
  assert.match(
    result.data.finding,
    /20 campaigns, with more in those statuses unread \(max_campaigns\)/u
  );
});
