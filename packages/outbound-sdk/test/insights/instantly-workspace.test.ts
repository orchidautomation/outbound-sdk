// The senders insights on an Instantly workspace the size of the OUT-109
// stress test: 303 mailboxes, 24 active campaigns among 120, each campaign
// sending from 120 of the mailboxes. Listing one campaign's senders re-reads
// the campaign and pages through every mailbox of the workspace, 2 requests a
// page, so the estimate has to price that or the default cap stops the run
// part way (OUT-112). With the workspace insights reading active campaigns
// by default, their default input finishes complete too (OUT-118).

import assert from "node:assert/strict";
import { test } from "node:test";

import { createOutbound, MemoryRateLimitStore } from "../../src/index.ts";
import {
  insightCost,
  insights,
  runInsightByName,
} from "../../src/insights/index.ts";
import { fixtureHandler } from "../helpers/adapter-suite.ts";
import { createClock } from "../helpers/clock.ts";
import { fixture } from "../helpers/fixtures.ts";
import { createFetch, json } from "../helpers/http.ts";
import type { RecordedRequest } from "../helpers/http.ts";
import { suite } from "../instantly/suite.ts";

const MAILBOXES = 303;
const CAMPAIGNS = 120;
const ACTIVE = 24;
const PER_CAMPAIGN = 120;

const first = <Item>(name: string): Item =>
  (fixture("instantly", `${name}.json`) as { items: Item[] }).items[0] as Item;

const account = first<Record<string, unknown>>("listAccounts");

const campaign = fixture("instantly", "getCampaign.json") as Record<
  string,
  unknown
>;

const address = (index: number) => `person${index + 1}@example.com`;

const campaigns = Array.from({ length: CAMPAIGNS }, (_, index) => ({
  ...campaign,
  email_list: Array.from({ length: PER_CAMPAIGN }, (_unused, at) =>
    address((index * 7 + at) % MAILBOXES)
  ),
  email_tag_list: [],
  id: `01a1d77f-5e23-7a9a-9112-${String(index).padStart(12, "0")}`,
  name: `Campaign ${index + 1}`,
  status: index < ACTIVE ? 1 : 2,
}));

const mailboxes = Array.from({ length: MAILBOXES }, (_, index) => ({
  ...account,
  email: address(index),
}));

/** One page of a listing, by Instantly's `limit` and `starting_after`. */
const page = (
  items: readonly Record<string, unknown>[],
  url: URL,
  key: string
) => {
  const limit = Number(url.searchParams.get("limit") ?? 100);
  const after = url.searchParams.get("starting_after");

  const start =
    after === null ? 0 : items.findIndex((item) => item[key] === after) + 1;

  const slice = items.slice(start, start + limit);
  const last = slice.at(-1);

  return json({
    items: slice,
    next_starting_after:
      start + limit < items.length && last !== undefined
        ? last[key]
        : undefined,
  });
};

const workspace = (request: RecordedRequest): Response | undefined => {
  const url = new URL(request.url);
  const path = decodeURIComponent(url.pathname);

  if (path === "/api/v2/accounts") {
    return page(mailboxes, url, "email");
  }

  if (path === "/api/v2/campaigns") {
    return page(campaigns, url, "id");
  }

  const one = /^\/api\/v2\/campaigns\/(?<id>[\w-]+)$/u.exec(path)?.groups?.id;
  const found = campaigns.find((each) => each.id === one);

  return found === undefined ? undefined : json(found);
};

const outboundOver = () => {
  const clock = createClock();
  const unrouted: string[] = [];
  const fromFixtures = fixtureHandler([suite], unrouted);

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

for (const name of ["sender_capacity", "sender_load"] as const) {
  test(`${name} finishes on default input on a stress-test-sized Instantly workspace`, async () => {
    const { http, outbound, settle } = outboundOver();
    const cost = insightCost(outbound, name);

    assert.ok(cost);

    const result = await settle(runInsightByName(outbound, name, {}));

    assert.equal(result.meta.complete, true, result.meta.notes.join("\n"));
    assert.equal(result.meta.requests, http.requests.length);
    assert.ok(
      http.requests.length <= cost.defaultCap,
      `${http.requests.length} requests over the default cap of ${cost.defaultCap}`
    );
    assert.ok(
      !result.meta.notes.some((note) => note.startsWith("Stopped after")),
      result.meta.notes.join("\n")
    );

    // Every active campaign's senders are listed: 4 pages of mailboxes,
    // each also reading the campaign again.
    const listings = http.requests.filter(
      (request) => new URL(request.url).pathname === "/api/v2/accounts"
    ).length;

    assert.ok(listings >= ACTIVE * 4, `${listings} mailbox pages`);
  });
}

for (const name of [
  "campaign_ranking",
  "period_comparison",
  "channel_mix",
  "tag_rollup",
  "warmup_readiness",
  "client_report",
]) {
  test(`${name} finishes on default input on a stress-test-sized Instantly workspace (OUT-118)`, async () => {
    const { http, outbound, settle } = outboundOver();
    const cost = insightCost(outbound, name);
    const result = await settle(runInsightByName(outbound, name, {}));

    assert.ok(cost);
    assert.equal(result.meta.complete, true, result.meta.notes.join("\n"));
    assert.ok(http.requests.length <= cost.defaultCap);
  });
}
