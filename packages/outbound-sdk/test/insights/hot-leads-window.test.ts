// hot_leads starts from the signal (OUT-113). The stress-test workspace had
// about 180 replies from 147 people in 14 days, and three leads marked
// Interested who replied 1 to 6 days ago were the real hot leads, while
// Interested leads whose last reply was years old topped a walk of the lead
// list. This rebuilds that shape offline: every reply in the window, the
// leads Instantly labels positive, and one lookup per 100 addresses.

import assert from "node:assert/strict";
import { test } from "node:test";

import { createOutbound, MemoryRateLimitStore } from "../../src/index.ts";
import { insights } from "../../src/insights/index.ts";
import { fixtureHandler } from "../helpers/adapter-suite.ts";
import { createClock } from "../helpers/clock.ts";
import { fixture } from "../helpers/fixtures.ts";
import { createFetch, json } from "../helpers/http.ts";
import { suite as instantly } from "../instantly/suite.ts";

type Raw = Record<string, unknown>;

const NOW = Date.parse("2026-11-16T12:00:00.000Z");
const DAY = 86_400_000;
const CAMPAIGN = "01a1d77f-5e65-78a7-8eb0-0213c3e7d6dd";

const [template] = (
  fixture("instantly", "listReplies.sameLead.json") as { items: Raw[] }
).items;

const ago = (days: number): string => new Date(NOW - days * DAY).toISOString();

const lead = (
  email: string,
  interest: number | null,
  replies: number,
  lastReply: string | null
): Raw => ({
  campaign: CAMPAIGN,
  email,
  email_reply_count: replies,
  first_name: "Sam",
  id: `lead-${email}`,
  lt_interest_status: interest,
  status: 1,
  timestamp_created: "2026-01-01T00:00:00.000Z",
  timestamp_last_reply: lastReply,
});

const received = (email: string, at: string, index: number): Raw => ({
  ...template,
  campaign_id: CAMPAIGN,
  from_address_email: email,
  i_status: null,
  id: `reply-${index}`,
  lead: email,
  subject: "Re: A quick question",
  timestamp_created: at,
  timestamp_email: at,
});

// The three hot leads: Interested, replied 7, 3 and 1 times, 5, 5 and 6 days ago.
const HOT = [
  { at: 5, email: "hot1@example.com", replies: 7 },
  { at: 5.2, email: "hot2@example.com", replies: 3 },
  { at: 6, email: "hot3@example.com", replies: 1 },
];

// Interested long ago: last replies 647 and 713 days back.
const OLD = [
  lead("old1@example.com", 1, 1, ago(647)),
  lead("old2@example.com", 1, 1, ago(713)),
];

// 144 more people who replied once in the window, the first of them twice,
// without a label; one of them was deleted since.
const OTHERS = Array.from(
  { length: 144 },
  (_, index) => `person${index + 100}@example.com`
);

const GONE = OTHERS.at(-1) ?? "";

const REPLIES: Raw[] = [
  ...HOT.flatMap(({ at, email, replies }) =>
    Array.from({ length: replies }, (_, index) =>
      received(email, ago(at + index * 0.01), 0)
    )
  ),
  ...OTHERS.map((email, index) => received(email, ago(1 + (index % 12)), 0)),
  received(OTHERS[0] ?? "", ago(0.5), 0),
]
  .map((reply, index): Raw => ({ ...reply, id: `reply-${index}` }))
  .toSorted((left, right) =>
    String(right.timestamp_created).localeCompare(
      String(left.timestamp_created)
    )
  );

const LEADS = new Map<string, Raw>([
  ...HOT.map(({ at, email, replies }): [string, Raw] => [
    email,
    lead(email, 1, replies, ago(at)),
  ]),
  ...OTHERS.filter((email) => email !== GONE).map((email): [string, Raw] => [
    email,
    lead(email, null, 1, null),
  ]),
]);

const build = () => {
  const clock = createClock();
  const unrouted: string[] = [];
  const fixtures = fixtureHandler([instantly], unrouted);

  const http = createFetch((request, index) => {
    const url = new URL(request.url);

    const body = (
      request.body === undefined ? {} : JSON.parse(request.body)
    ) as Raw;

    if (url.pathname === "/api/v2/emails") {
      const after = Number(url.searchParams.get("starting_after") ?? 0);
      const items = REPLIES.slice(after, after + 100);

      // A cursor on the last page too, as seen live; none on the empty page after.
      return json(
        items.length === 0
          ? { items }
          : { items, next_starting_after: String(after + items.length) }
      );
    }

    if (url.pathname === "/api/v2/leads/list" && body.filter !== undefined) {
      return json({
        items:
          body.filter === "FILTER_LEAD_INTERESTED"
            ? [...HOT.map(({ email }) => LEADS.get(email)), ...OLD]
            : [],
        next_starting_after: "x",
      });
    }

    if (url.pathname === "/api/v2/leads/list" && Array.isArray(body.contacts)) {
      return json(
        body.starting_after === undefined
          ? {
              items: body.contacts.flatMap(
                (email) => LEADS.get(String(email)) ?? []
              ),
              next_starting_after: "y",
            }
          : { items: [] }
      );
    }

    return fixtures(request, index);
  });

  const outbound = createOutbound({
    adapter: instantly.make(),
    fetch: http.fetch,
    plugins: [insights()],
    rateLimitStore: new MemoryRateLimitStore(),
    runtime: clock.runtime,
    share: 1,
  });

  return { clock, http, outbound, unrouted };
};

test("hot_leads on the stress-test shape answers completely in about 10 requests, the three hot leads first", async () => {
  const { clock, http, outbound, unrouted } = build();

  const result = await clock.settle(
    outbound.insights.hotLeads({}, { now: NOW })
  );

  assert.deepEqual(unrouted, []);
  assert.equal(result.meta.complete, true, result.meta.notes.join(" "));
  assert.deepEqual(result.meta.notes, []);

  // 2 pages of replies and the empty page after, 5 positive filters, and 2
  // lookups of addresses, the full first one followed by an empty page.
  assert.equal(http.requests.length, 11);
  assert.equal(result.meta.requests, 11);

  assert.deepEqual(
    result.data.leads.slice(0, 3).map((each) => each.email),
    HOT.map(({ email }) => email)
  );
  assert.equal(result.data.totals.repliesRead, REPLIES.length);
  assert.equal(result.data.totals.unreadable, 1, "the deleted lead is counted");
  assert.equal(result.data.totals.fromReplies, OTHERS.length - 1);
  assert.equal(result.data.totals.stale, 2);
});

test("hot_leads ranks no lead whose last reply is past max_age_days above one who replied within recency_days", async () => {
  const { clock, outbound } = build();

  const result = await clock.settle(
    outbound.insights.hotLeads({ limit: 500 }, { now: NOW })
  );

  const at = (email: string) =>
    result.data.leads.findIndex((each) => each.email === email);

  const fresh = result.data.leads.filter(
    (each) =>
      each.lastRepliedAt !== null &&
      NOW - Date.parse(each.lastRepliedAt) <= 14 * DAY
  );

  assert.ok(fresh.length > 140);

  for (const old of ["old1@example.com", "old2@example.com"]) {
    const record = result.data.leads[at(old)];

    assert.ok(at(old) > Math.max(...fresh.map((each) => at(each.email ?? ""))));
    assert.equal(record?.parts.interest, 0, "the label faded to nothing");
  }
});

test("hot_leads looks up the leads behind replies in batches of 100 addresses", async () => {
  const { clock, http, outbound } = build();

  await clock.settle(outbound.insights.hotLeads({}, { now: NOW }));

  const batches = http.requests.flatMap((request) => {
    const body = request.body === undefined ? {} : JSON.parse(request.body);

    return Array.isArray(body.contacts) ? [body.contacts.length] : [];
  });

  assert.deepEqual(batches, [100, 100, OTHERS.length - 100]);
});

test("hot_leads walks the lead list only when asked, for open and click scoring", async () => {
  const { clock, http, outbound } = build();

  await clock.settle(
    outbound.insights.hotLeads({ include_engagement_only: true }, { now: NOW })
  );

  const walks = http.requests.filter((request) => {
    const body = request.body === undefined ? {} : JSON.parse(request.body);

    return (
      new URL(request.url).pathname === "/api/v2/leads/list" &&
      body.filter === undefined &&
      body.contacts === undefined
    );
  });

  assert.ok(walks.length > 0);
});
