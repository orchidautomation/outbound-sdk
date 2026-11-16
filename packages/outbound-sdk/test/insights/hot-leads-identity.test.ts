// What hot_leads reads stays tied to the right record (review of OUT-113): a
// person in two workspaces is two people, a reply in one campaign says
// nothing about the person's record in another, a label the vendor's
// positive filter does not return is still looked for, and a call that
// cannot be answered is refused before any request.

import assert from "node:assert/strict";
import { test } from "node:test";

import { combine } from "../../src/combine/index.ts";
import {
  createOutbound,
  MemoryRateLimitStore,
  OutboundError,
} from "../../src/index.ts";
import type { OutboundPlugin } from "../../src/index.ts";
import { insights } from "../../src/insights/index.ts";
import { instantly } from "../../src/instantly/index.ts";
import { memory } from "../../src/memory/index.ts";
import { createClock } from "../helpers/clock.ts";
import { fixture } from "../helpers/fixtures.ts";
import { createFetch, json } from "../helpers/http.ts";
import type { RecordedRequest } from "../helpers/http.ts";

type Raw = Record<string, unknown>;

const NOW = Date.parse("2026-11-16T12:00:00.000Z");
const DAY = 86_400_000;
const A = "01a1d77f-5e65-78a7-8eb0-0213c3e7d6da";
const B = "01a1d77f-5e65-78a7-8eb0-0213c3e7d6db";

const ago = (days: number): string => new Date(NOW - days * DAY).toISOString();

const [template] = (
  fixture("instantly", "listReplies.sameLead.json") as { items: Raw[] }
).items;

const lead = (
  email: string,
  campaign: string,
  interest: number | null,
  lastReply: string | null
): Raw => ({
  campaign,
  email,
  email_reply_count: 1,
  id: `lead-${campaign}-${email}`,
  lt_interest_status: interest,
  status: 1,
  timestamp_last_reply: lastReply,
});

const reply = (email: string, campaign: string, days: number): Raw => ({
  ...template,
  campaign_id: campaign,
  from_address_email: email,
  i_status: null,
  id: `reply-${campaign}-${email}`,
  lead: email,
  timestamp_created: ago(days),
  timestamp_email: ago(days),
});

interface Workspace {
  readonly replies: readonly Raw[];
  readonly positive: readonly Raw[];
  readonly leads: readonly Raw[];
}

const body = (request: RecordedRequest): Raw =>
  request.body === undefined ? {} : (JSON.parse(request.body) as Raw);

const answer = (space: Workspace, request: RecordedRequest): Response => {
  const url = new URL(request.url);
  const sent = body(request);

  if (url.pathname === "/api/v2/emails") {
    return json({
      items: url.searchParams.has("starting_after") ? [] : space.replies,
    });
  }

  if (sent.filter !== undefined) {
    return json({
      items: sent.filter === "FILTER_LEAD_INTERESTED" ? space.positive : [],
    });
  }

  if (Array.isArray(sent.contacts)) {
    return json({
      items: space.leads.filter((each) =>
        (sent.contacts as unknown[]).includes(each.email)
      ),
    });
  }

  return json({
    items: url.pathname === "/api/v2/leads/list" ? space.leads : [],
  });
};

const KEYS = ["inst_key_a_0123456789abcdef", "inst_key_b_0123456789abcdef"];

const build = (spaces: readonly Workspace[]) => {
  const clock = createClock();

  const http = createFetch((request) => {
    const at = KEYS.findIndex(
      (key) => request.headers.authorization === `Bearer ${key}`
    );

    return answer(
      spaces[at] ?? { leads: [], positive: [], replies: [] },
      request
    );
  });

  const adapters = spaces.map((_, at) =>
    instantly({ apiKey: KEYS[at] ?? "", workspaceId: `client-${at}` })
  );

  const outbound = createOutbound({
    adapter:
      adapters.length === 1
        ? (adapters[0] ?? combine(adapters))
        : combine(adapters),
    fetch: http.fetch,
    plugins: [insights()],
    rateLimitStore: new MemoryRateLimitStore(),
    runtime: clock.runtime,
    share: 1,
  });

  return { clock, http, outbound };
};

test("hot_leads keeps one person who replied in two workspaces as two people", async () => {
  const person = "person1@example.com";

  const space = (campaign: string): Workspace => ({
    leads: [lead(person, campaign, null, ago(2))],
    positive: [],
    replies: [reply(person, campaign, 2)],
  });

  const { clock, outbound } = build([space(A), space(B)]);

  const result = await clock.settle(
    outbound.insights.hotLeads({}, { now: NOW })
  );

  assert.deepEqual(result.data.leads.map((each) => each.lead).toSorted(), [
    `instantly:client-0:lead-${A}-${person}`,
    `instantly:client-1:lead-${B}-${person}`,
  ]);
  assert.equal(result.data.totals.unreadable, 0);
});

test("hot_leads does not let a reply in one campaign freshen the person's old label in another", async () => {
  const person = "person2@example.com";

  const { clock, outbound } = build([
    {
      // Interested in campaign A two years ago; replied in campaign B yesterday.
      leads: [lead(person, A, 1, ago(700)), lead(person, B, null, ago(1))],
      positive: [lead(person, A, 1, ago(700))],
      replies: [reply(person, B, 1)],
    },
  ]);

  const result = await clock.settle(
    outbound.insights.hotLeads({}, { now: NOW })
  );

  const [first, second] = result.data.leads;

  assert.equal(
    first?.campaign,
    `instantly:client-0:${B}`,
    "the campaign that replied leads"
  );
  assert.equal(second?.campaign, `instantly:client-0:${A}`);
  assert.equal(second?.parts.interest, 0, "the old label faded");
  assert.equal(result.data.totals.stale, 1);
});

test("hot_leads walks the lead list for a positive label the vendor's filter does not return", async () => {
  const person = "person3@example.com";

  const { clock, http, outbound } = build([
    { leads: [lead(person, A, 1, null)], positive: [], replies: [] },
  ]);

  await clock.settle(
    outbound.insights.hotLeads(
      { positive_labels: ["Interested", "Wrong Timing"] },
      { now: NOW }
    )
  );

  const walked = http.requests.some((request) => {
    const sent = body(request);

    return (
      new URL(request.url).pathname === "/api/v2/leads/list" &&
      sent.filter === undefined &&
      sent.contacts === undefined
    );
  });

  assert.ok(walked);
});

test("hot_leads refuses before any request when it cannot list the leads it needs", async () => {
  const seen: string[] = [];

  const counter: OutboundPlugin = {
    name: "counter",
    wrap: (operation, next) => {
      seen.push(operation.kind);

      return next(operation);
    },
  };

  const make = (capabilities: Record<string, boolean>) =>
    createOutbound({
      adapter: memory({
        capabilities,
        data: { campaigns: [{ id: "c1" }], messages: [] },
        workspaceId: "agency",
      }),
      plugins: [counter, insights()],
    });

  await assert.rejects(
    make({ "leads.list": false }).insights.hotLeads({}),
    (error) =>
      OutboundError.is(error) &&
      error.code === "Unsupported" &&
      /leads\.list/u.test(error.message)
  );

  await assert.rejects(
    make({ "leads.byCampaign": false }).insights.hotLeads({
      campaign: "memory:agency:c1",
    }),
    (error) =>
      OutboundError.is(error) &&
      error.code === "Unsupported" &&
      /leads\.byCampaign/u.test(error.message)
  );

  assert.deepEqual(seen, [], "no read was made");
});

test("an Instantly listing by interest keeps only the exact domain asked for", async () => {
  const { clock, outbound } = build([
    {
      leads: [],
      positive: [
        lead("one@acme.example", A, 1, null),
        lead("two@other.example", A, 1, null),
        lead("three@sub.acme.example", A, 1, null),
      ],
      replies: [],
    },
  ]);

  const found = await clock.settle(
    (async () => {
      const all = [];

      for await (const each of outbound.leads.listAll({
        domain: "acme.example",
        interest: "positive",
      })) {
        all.push(each.email);
      }

      return all;
    })()
  );

  assert.deepEqual(found, ["one@acme.example"]);
});
