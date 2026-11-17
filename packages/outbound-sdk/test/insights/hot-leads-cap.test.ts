// hot_leads past max_leads, and out-of-office replies. A lead listing comes
// in the vendor's order, so a cap can cut off the leads worth calling; the
// leads behind recent replies are read as well. And a vendor's reply count
// may include automatic replies, so a lead labelled out-of-office earns no
// reply points.

import assert from "node:assert/strict";
import { test } from "node:test";

import { createOutbound, MemoryRateLimitStore } from "../../src/index.ts";
import { insights } from "../../src/insights/index.ts";
import type {
  MemoryData,
  MemoryLead,
  MemoryMessage,
} from "../../src/memory/index.ts";
import { fixtureHandler } from "../helpers/adapter-suite.ts";
import { createClock } from "../helpers/clock.ts";
import { fixture } from "../helpers/fixtures.ts";
import { createFetch, json } from "../helpers/http.ts";
import { suite as instantly } from "../instantly/suite.ts";
import { NOW, single } from "./helpers.ts";

const COLD = 1840;
const ENGAGED = 5;

const cold = (index: number): MemoryLead => ({
  campaignId: "c1",
  email: `cold${index}@example.com`,
  engagement: { clicks: 0, opens: 0, replies: 0 },
  id: `cold${index}`,
  status: "active",
});

const engaged = (index: number): MemoryLead => ({
  campaignId: "c1",
  email: `warm${index}@example.com`,
  engagement: {
    lastRepliedAt: `2026-11-1${index}T09:00:00.000Z`,
    opens: 2,
    replies: 1,
  },
  firstName: `Warm${index}`,
  id: `warm${index}`,
  interest: "Interested",
  status: "replied",
});

const reply = (index: number): MemoryMessage => ({
  campaignId: "c1",
  category: "positive",
  direction: "in",
  id: `reply${index}`,
  isAuto: false,
  leadId: `warm${index}`,
  sentAt: `2026-11-1${index}T09:00:00.000Z`,
  threadId: `thread${index}`,
});

// 1,840 cold leads listed first, then the five who replied.
const CAPPED: MemoryData = {
  campaigns: [{ id: "c1", name: "Agency owners" }],
  leads: [
    ...Array.from({ length: COLD }, (_, index) => cold(index)),
    ...Array.from({ length: ENGAGED }, (_, index) => engaged(index)),
  ],
  messages: Array.from({ length: ENGAGED }, (_, index) => reply(index)),
};

test("hot_leads finds the leads that replied past the max_leads cap", async () => {
  const result = await single(CAPPED).insights.hotLeads(
    { limit: 5, max_leads: 500 },
    { now: NOW }
  );

  assert.deepEqual(
    result.data.leads.map((each) => each.email).toSorted(),
    Array.from({ length: ENGAGED }, (_, index) => `warm${index}@example.com`)
  );
  assert.equal(result.data.totals.moreLeadsExist, true);
  assert.equal(result.data.totals.fromReplies, ENGAGED);
  assert.equal(result.data.totals.leadsRead, 500 + ENGAGED);
  assert.equal(result.meta.complete, false);
});

test("hot_leads says in its data that leads went unscored when it cannot look past the cap", async () => {
  const result = await single(CAPPED, {
    "replies.list": false,
  }).insights.hotLeads({ limit: 5, max_leads: 500 }, { now: NOW });

  assert.deepEqual(result.data.leads, []);
  assert.equal(result.data.totals.moreLeadsExist, true);
  assert.equal(result.data.totals.fromReplies, 0);
  assert.ok(
    result.meta.notes.includes(
      "This tool cannot list replies, so leads were ranked from the lead records alone."
    )
  );
});

// The live shape of 2026-11-17 (OUT-109): 505 leads labelled positive,
// more than the old default of 500.
test("hot_leads on its default input reads 505 leads labelled positive in full", async () => {
  const result = await single({
    campaigns: [{ id: "c1", name: "Agency owners" }],
    leads: Array.from({ length: 505 }, (_, index) => ({
      ...engaged(index % ENGAGED),
      email: `positive${index}@example.com`,
      id: `positive${index}`,
    })),
  }).insights.hotLeads({}, { now: NOW });

  assert.equal(result.data.totals.moreLeadsExist, false);
  assert.equal(result.data.totals.hot, 505);
  assert.equal(result.meta.complete, true, result.meta.notes.join(" | "));
});

test("hot_leads reads no replies when the listing was not cut short", async () => {
  const result = await single(CAPPED).insights.hotLeads(
    { limit: 5, max_leads: 5000 },
    { now: NOW }
  );

  assert.equal(result.data.totals.moreLeadsExist, false);
  assert.equal(result.data.totals.fromReplies, 0);
  assert.equal(result.data.leads.length, ENGAGED);
});

const OUT_OF_OFFICE: MemoryData = {
  leads: [
    {
      campaignId: "c1",
      email: "away@example.com",
      engagement: {
        lastRepliedAt: "2026-11-13T09:00:00.000Z",
        opens: 0,
        replies: 1,
      },
      id: "away",
      interest: "Out of office",
      interestCategory: "ooo",
      status: "replied",
    },
    {
      campaignId: "c1",
      email: "away-but-opened@example.com",
      engagement: {
        lastRepliedAt: "2026-11-13T09:00:00.000Z",
        opens: 2,
        replies: 1,
      },
      id: "opened",
      interest: "Out of office",
      interestCategory: "ooo",
      status: "replied",
    },
  ],
};

test("hot_leads gives an out-of-office reply no reply or recency points", async () => {
  const result = await single(OUT_OF_OFFICE).insights.hotLeads(
    {},
    { now: NOW }
  );

  // The lead whose only signal is the automatic reply scores 0 and is left out.
  assert.deepEqual(
    result.data.leads.map((each) => [each.email, each.score]),
    [["away-but-opened@example.com", 2]]
  );

  const [opened] = result.data.leads;

  assert.equal(opened?.parts.replies, 0);
  assert.equal(opened?.parts.recency, 0);
  assert.equal(
    opened?.reason,
    "marked Out of office, so replies earn nothing, 2 opens."
  );
  assert.doesNotMatch(opened?.reason ?? "", /replied/u);
  assert.equal(result.data.totals.autoReplied, 2);
});

test("hot_leads reads an unmapped out-of-office label by a fixed rule", async () => {
  const result = await single({
    leads: [
      {
        campaignId: "c1",
        email: "away@example.com",
        engagement: {
          lastRepliedAt: "2026-11-13T09:00:00.000Z",
          opens: 1,
          replies: 1,
        },
        id: "away",
        interest: "Out Of Office",
        status: "replied",
      },
      {
        campaignId: "c1",
        email: "office@example.com",
        engagement: { opens: 0, replies: 1 },
        id: "office",
        interest: "Back in the office, interested",
        status: "replied",
      },
    ],
  }).insights.hotLeads({}, { now: NOW });

  assert.deepEqual(
    result.data.leads.map((each) => [each.email, each.score]),
    [
      ["office@example.com", 10],
      ["away@example.com", 1],
    ]
  );
  assert.equal(result.data.totals.autoReplied, 1);
});

test("hot_leads on Instantly past the cap counts every request it makes", async () => {
  const clock = createClock();
  const unrouted: string[] = [];
  const http = createFetch(fixtureHandler([instantly], unrouted));

  const outbound = createOutbound({
    adapter: instantly.make(),
    fetch: http.fetch,
    plugins: [insights()],
    rateLimitStore: new MemoryRateLimitStore(),
    runtime: clock.runtime,
    share: 1,
  });

  const result = await clock.settle(
    outbound.insights.hotLeads({ max_leads: 1 })
  );

  assert.deepEqual(unrouted, []);
  assert.equal(result.data.totals.moreLeadsExist, true);
  assert.equal(result.meta.requests, http.requests.length);
  assert.ok(
    http.requests.some((request) =>
      new URL(request.url).searchParams.has("email_type")
    ),
    "it read the replies"
  );
});

test("hot_leads on Instantly does not read again a listed lead its reply names by address", async () => {
  const clock = createClock();
  const unrouted: string[] = [];
  const fixtures = fixtureHandler([instantly], unrouted);

  const repliers = fixture("instantly", "listLeadsByEmail.repliers.json") as {
    items: object[];
  };

  const [received] = (
    fixture("instantly", "listReplies.sameLead.json") as { items: object[] }
  ).items;

  const http = createFetch((request, index) => {
    const url = new URL(request.url);
    const body = request.body === undefined ? {} : JSON.parse(request.body);

    if (url.pathname === "/api/v2/leads/list" && body.contacts === undefined) {
      // The leads labelled Interested: person16.
      return json({ items: repliers.items.slice(1, 2) });
    }

    return url.searchParams.get("email_type") === "received"
      ? json({
          // Both in person16's campaign, so the reply is the listed record's.
          items: ["person16@example.com", "person31@example.com"].map(
            (lead, at) => ({
              ...received,
              campaign_id: "01a1d77f-5e65-78a7-8eb0-0213c3e7d6dd",
              id: `reply-${at}`,
              lead,
            })
          ),
        })
      : fixtures(request, index);
  });

  const outbound = createOutbound({
    adapter: instantly.make(),
    fetch: http.fetch,
    plugins: [insights()],
    rateLimitStore: new MemoryRateLimitStore(),
    runtime: clock.runtime,
    share: 1,
  });

  await clock.settle(
    outbound.insights.hotLeads(
      {},
      { now: Date.parse("2026-11-16T12:00:00.000Z") }
    )
  );

  const lookups = http.requests.flatMap((request) => {
    const body = request.body === undefined ? {} : JSON.parse(request.body);

    return body.contacts ?? [];
  });

  assert.deepEqual(unrouted, []);
  assert.deepEqual(lookups, ["person31@example.com"], "person16 was listed");
});
