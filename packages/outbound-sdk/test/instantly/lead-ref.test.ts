// An Instantly email names its lead by address, not by lead id, so a
// message's and a reply's leadRef is built from that address (OUT-87).

import assert from "node:assert/strict";
import { test } from "node:test";

import {
  createOutbound,
  MemoryRateLimitStore,
  OutboundError,
} from "../../src/index.ts";
import { redact } from "../../src/redact/index.ts";
import { fixtureHandler, harness } from "../helpers/adapter-suite.ts";
import { createClock } from "../helpers/clock.ts";
import { fixture } from "../helpers/fixtures.ts";
import { createFetch, json } from "../helpers/http.ts";
import { suite } from "./suite.ts";

const PERSON = "person31@example.com";
const PERSON_REF = `instantly:client-a:${PERSON}`;

const isReplies = (request: { url: string }): boolean => {
  const url = new URL(request.url);

  return (
    url.pathname === "/api/v2/emails" &&
    url.searchParams.get("email_type") === "received"
  );
};

/** Answers the reply list with `listReplies.sameLead.json`, or with `items`. */
const sameLead =
  (items?: readonly object[]) =>
  (request: { url: string }): Response | undefined =>
    isReplies(request)
      ? json(
          items === undefined
            ? fixture("instantly", "listReplies.sameLead.json")
            : { items }
        )
      : undefined;

const sameLeadItems = (): Record<string, unknown>[] =>
  (
    fixture("instantly", "listReplies.sameLead.json") as {
      items: Record<string, unknown>[];
    }
  ).items;

/** An Instantly instance behind redact, answered from the fixtures. */
const redacted = (strategy: "hash" | "mask") => {
  const clock = createClock();
  const unrouted: string[] = [];
  const fixtures = fixtureHandler([suite], unrouted);

  const http = createFetch(
    (request, index) => sameLead()(request) ?? fixtures(request, index)
  );

  return {
    outbound: createOutbound({
      adapter: suite.make(),
      fetch: http.fetch,
      plugins: [redact({ strategy })],
      rateLimitStore: new MemoryRateLimitStore(),
      runtime: clock.runtime,
      share: 1,
    }),
    settle: clock.settle,
    unrouted,
  };
};

test("instantly: two replies in one thread from the same lead share a leadRef", async () => {
  const { outbound, settle, unrouted } = harness(suite, sameLead());
  const page = await settle(outbound.replies.list());

  assert.deepEqual(unrouted, []);
  assert.equal(page.items.length, 2);
  assert.deepEqual(
    page.items.map((reply) => [reply.threadId, reply.leadRef]),
    [
      ["01a1d77f-5e65-78a7-8eb0-021717740231", PERSON_REF],
      ["01a1d77f-5e65-78a7-8eb0-021717740231", PERSON_REF],
    ]
  );
  assert.equal(
    new Set(page.items.map((reply) => reply.leadRef)).size,
    1,
    "two positive replies are one positive person"
  );
});

test("instantly: a leadRef comes from lead, then a received email's sender, then lead_id", async () => {
  const [reply] = sameLeadItems();

  const cases: [string, Record<string, unknown>, string | null][] = [
    ["lead is lowercased", { lead: "Person31@Example.COM" }, PERSON_REF],
    [
      "a received email without lead names the lead as its sender",
      { from_address_email: "Person31@Example.com", lead: null },
      PERSON_REF,
    ],
    [
      "lead_id is the last resort",
      { from_address_email: null, lead: null, lead_id: "lead-uuid-1" },
      "instantly:client-a:lead-uuid-1",
    ],
    [
      "a lead that is not an address is not taken",
      { from_address_email: null, lead: "not an address" },
      null,
    ],
    [
      "nothing to go on gives null",
      { from_address_email: null, lead: null },
      null,
    ],
  ];

  for (const [why, change, expected] of cases) {
    const { outbound, settle } = harness(
      suite,
      sameLead([{ ...reply, ...change }])
    );

    const [mapped] = (await settle(outbound.replies.list())).items;
    assert.equal(mapped?.leadRef, expected, why);
  }
});

test("instantly: a sent email's sender is the mailbox, never taken as the lead", async () => {
  const [email] = sameLeadItems();

  const { outbound, settle } = harness(suite, (request) =>
    new URL(request.url).pathname === "/api/v2/emails"
      ? json({
          items: [
            {
              ...email,
              from_address_email: "sender31@example.com",
              lead: null,
              ue_type: 1,
            },
          ],
        })
      : undefined
  );

  const [message] = (await settle(outbound.messages.list())).items;
  assert.equal(message?.direction, "out");
  assert.equal(message?.leadRef, null);
});

test("instantly: a reply's leadRef reads the lead with one lookup by email", async () => {
  const { outbound, requests, settle } = harness(suite);
  const [reply] = (await settle(outbound.replies.list())).items;
  const before = requests.length;

  assert.equal(reply?.leadRef, "instantly:client-a:person6@example.com");
  const lead = await settle(outbound.leads.get(reply?.leadRef ?? ""));

  const sent = requests.slice(before);
  assert.deepEqual(
    sent.map((request) => `${request.method} ${new URL(request.url).pathname}`),
    ["POST /api/v2/leads/list"]
  );
  assert.deepEqual(JSON.parse(sent[0]?.body ?? "{}"), {
    contacts: ["person6@example.com"],
    limit: 100,
  });
  assert.equal(lead.email, "person6@example.com");
  assert.equal(lead.firstName, "Sam");
  assert.equal(
    lead.ref,
    "instantly:client-a:01a1d77f-5e65-78a7-8eb0-0216d691e16c",
    "the lead keeps its own ref, its lead id"
  );
});

test("instantly: a leadRef for an address no lead has is NotFound", async () => {
  const { outbound, settle } = harness(suite, (request) =>
    new URL(request.url).pathname === "/api/v2/leads/list"
      ? json({ items: [] })
      : undefined
  );

  await assert.rejects(
    settle(outbound.leads.get("instantly:client-a:nobody@example.com")),
    (error) => OutboundError.is(error) && error.code === "NotFound"
  );
  assert.equal(
    await settle(
      outbound.leads.exists("instantly:client-a:nobody@example.com")
    ),
    false
  );
});

test("instantly: a reply's leadRef reads the lead's timeline without reading the lead", async () => {
  const { outbound, requests, settle } = harness(suite);
  await settle(outbound.lead(PERSON_REF).timeline());

  assert.deepEqual(
    requests.map((request) => new URL(request.url).pathname),
    ["/api/v2/emails", "/api/v2/emails"]
  );
  assert.equal(
    new URL(requests[0]?.url ?? "").searchParams.get("lead"),
    PERSON
  );
});

test("instantly under redact: the address is masked, and one person still has one leadRef", async () => {
  const { outbound, settle, unrouted } = redacted("hash");

  const replies = (await settle(outbound.replies.list())).items;

  const [lead] = (await settle(outbound.leads.list({ email: PERSON }))).items;

  assert.deepEqual(unrouted, []);
  assert.equal(replies.length, 2);
  assert.doesNotMatch(JSON.stringify(replies), /person31|@example\.com/u);

  const [first, second] = replies;
  assert.match(
    first?.leadRef ?? "",
    /^instantly:client-a:redacted:[0-9a-f]{16}$/u
  );
  assert.equal(first?.leadRef, second?.leadRef, "still one person");

  // The token is the one the lead's email gets, so a reply still joins to
  // the lead a lookup by that address returns.
  assert.equal(lead?.email, outbound.redacted.hash(PERSON));
  assert.equal(first?.leadRef, `instantly:client-a:${lead?.email ?? ""}`);
});

test("instantly under redact with mask: the address never shows in a leadRef, and the lead still joins", async () => {
  const { outbound, settle } = redacted("mask");
  const replies = (await settle(outbound.replies.list())).items;
  const [lead] = (await settle(outbound.leads.list({ email: PERSON }))).items;

  assert.doesNotMatch(JSON.stringify([replies, lead]), /@/u);
  const [first, second] = replies;
  assert.match(
    first?.leadRef ?? "",
    /^instantly:client-a:redacted:[0-9a-f]{16}$/u,
    "a keyed token, never one [redacted] for everyone (OUT-122)"
  );
  assert.equal(first?.leadRef, second?.leadRef, "still one person");
  assert.equal(first?.leadRef, `instantly:client-a:${lead?.email ?? ""}`);
});
