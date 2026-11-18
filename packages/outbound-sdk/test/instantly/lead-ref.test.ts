// An Instantly email names its lead by address only, and one address is one
// lead per campaign. A message's and a reply's leadRef is the lead's own ref,
// the one leads.list returns, found by looking the page's addresses up once
// and matching the campaign; the address is in leadEmail (OUT-149, which
// replaced OUT-87's address-shaped leadRef).

import assert from "node:assert/strict";
import { test } from "node:test";

import {
  createOutbound,
  MemoryRateLimitStore,
  OutboundError,
} from "../../src/index.ts";
import { redact } from "../../src/redact/index.ts";
import { createTools } from "../../src/tools/index.ts";
import { fixtureHandler, harness } from "../helpers/adapter-suite.ts";
import { createClock } from "../helpers/clock.ts";
import { fixture } from "../helpers/fixtures.ts";
import { createFetch, json } from "../helpers/http.ts";
import { suite } from "./suite.ts";

const PERSON = "person31@example.com";
const PERSON_LEAD = "instantly:client-a:01a1d77f-5e65-78a7-8eb0-0216d691e131";
const CAMPAIGN = "01a1d77f-5e65-78a7-8eb0-0213c3e7d6dc";
const OTHER_CAMPAIGN = "01a1d77f-5e65-78a7-8eb0-0213c3e7d6dd";

const path = (request: { url: string }): string =>
  new URL(request.url).pathname;

const isReplies = (request: { url: string }): boolean =>
  path(request) === "/api/v2/emails" &&
  new URL(request.url).searchParams.get("email_type") === "received";

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
    requests: http.requests,
    settle: clock.settle,
    unrouted,
  };
};

test("instantly: a reply's leadRef is the lead's own ref, so it joins to leads.list by ref", async () => {
  const { outbound, settle, unrouted } = harness(suite, sameLead());
  const page = await settle(outbound.replies.list());
  const [lead] = (await settle(outbound.leads.list({ email: PERSON }))).items;

  assert.deepEqual(unrouted, []);
  assert.deepEqual(
    page.items.map((reply) => [reply.leadRef, reply.leadEmail]),
    [
      [PERSON_LEAD, PERSON],
      [PERSON_LEAD, PERSON],
    ]
  );
  assert.equal(lead?.ref, PERSON_LEAD);
});

test("instantly: one page of replies costs one lookup of its addresses", async () => {
  const { outbound, requests, settle } = harness(suite, sameLead());
  await settle(outbound.replies.list());

  assert.deepEqual(
    requests.map((request) => `${request.method} ${path(request)}`),
    ["GET /api/v2/emails", "POST /api/v2/leads/list"]
  );
  assert.deepEqual(JSON.parse(requests[1]?.body ?? "{}"), {
    contacts: [PERSON],
    limit: 100,
  });
});

test("instantly: leadEmail comes from lead, then a received email's sender; leadRef from lead_id or the lookup", async () => {
  const [reply] = sameLeadItems();

  const cases: [
    string,
    Record<string, unknown>,
    string | null,
    string | null,
  ][] = [
    [
      "lead is lowercased",
      { lead: "Person31@Example.COM" },
      PERSON,
      PERSON_LEAD,
    ],
    [
      "a received email without lead names the lead as its sender",
      { from_address_email: "Person31@Example.com", lead: null },
      PERSON,
      PERSON_LEAD,
    ],
    [
      "lead_id, when an email carries one, is taken as it is",
      { lead_id: "lead-uuid-1" },
      PERSON,
      "instantly:client-a:lead-uuid-1",
    ],
    [
      "a lead in another campaign is not this email's lead",
      { campaign_id: OTHER_CAMPAIGN },
      PERSON,
      null,
    ],
    [
      "a lead that is not an address is not taken",
      { from_address_email: null, lead: "not an address" },
      null,
      null,
    ],
    [
      "nothing to go on gives null",
      { from_address_email: null, lead: null },
      null,
      null,
    ],
  ];

  for (const [why, change, email, ref] of cases) {
    const { outbound, settle } = harness(
      suite,
      sameLead([{ ...reply, ...change }])
    );

    const [mapped] = (await settle(outbound.replies.list())).items;

    assert.equal(mapped?.leadEmail, email, why);
    assert.equal(mapped?.leadRef, ref, why);
  }
});

test("instantly: an address with leads in two campaigns joins each reply to its own campaign's lead", async () => {
  const [reply] = sameLeadItems();

  const { outbound, settle } = harness(suite, (request) => {
    if (isReplies(request)) {
      return json({
        items: [
          { ...reply, campaign_id: CAMPAIGN, id: "email-a" },
          { ...reply, campaign_id: OTHER_CAMPAIGN, id: "email-b" },
        ],
      });
    }

    return path(request) === "/api/v2/leads/list"
      ? json({
          items: [
            { campaign: CAMPAIGN, email: PERSON, id: "lead-in-a" },
            { campaign: OTHER_CAMPAIGN, email: PERSON, id: "lead-in-b" },
          ],
        })
      : undefined;
  });

  const replies = (await settle(outbound.replies.list())).items;

  assert.deepEqual(
    replies.map((each) => each.leadRef),
    ["instantly:client-a:lead-in-a", "instantly:client-a:lead-in-b"]
  );

  // Two leads, one person: reply_samples counts and groups people by address.
  const samples = createTools(outbound).find(
    (tool) => tool.name === "reply_samples"
  );

  assert.ok(samples);

  const result = await settle(samples.call({ by: "person" } as never));
  assert.equal(result.ok, true, JSON.stringify(result));

  const { data } = result as unknown as {
    data: {
      people: { leadEmail: string; messages: number }[];
      uniquePeople: number;
    };
  };

  assert.equal(data.uniquePeople, 1);
  assert.deepEqual(
    data.people.map((each) => [each.leadEmail, each.messages]),
    [[PERSON, 2]]
  );
});

test("instantly: a sent email's sender is the mailbox, never taken as the lead", async () => {
  const [email] = sameLeadItems();

  const { outbound, settle } = harness(suite, (request) =>
    path(request) === "/api/v2/emails"
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
  assert.equal(message?.leadEmail, null);
});

test("instantly: a lead's timeline is read in the lead's own campaign, and names it as the lead", async () => {
  const { outbound, requests, settle } = harness(suite);
  const lead = "instantly:client-a:01a1d77f-5156-7723-b616-dca4fb991449";
  const timeline = await settle(outbound.lead(lead).timeline());

  assert.deepEqual(
    requests.slice(0, 2).map((request) => path(request)),
    ["/api/v2/leads/01a1d77f-5156-7723-b616-dca4fb991449", "/api/v2/emails"]
  );

  const query = new URL(requests[1]?.url ?? "").searchParams;

  assert.equal(query.get("lead"), "person1@example.com");
  assert.equal(
    query.get("campaign_id"),
    "01a1d77f-5158-772f-ad63-67da136d2f76"
  );
  // The lead is known, so no lookup is made.
  assert.ok(
    !requests.some((request) => path(request) === "/api/v2/leads/list")
  );
  assert.ok(
    timeline.items.every(
      (message) =>
        message.leadRef === lead || message.leadEmail !== "person1@example.com"
    )
  );
});

test("instantly: a ref that names its lead by address, as refs did before, still reads the timeline", async () => {
  const { outbound, requests, settle } = harness(suite);
  await settle(outbound.lead(`instantly:client-a:${PERSON}`).timeline());

  assert.equal(
    new URL(
      requests.find((request) => path(request) === "/api/v2/emails")?.url ?? ""
    ).searchParams.get("lead"),
    PERSON
  );
});

test("instantly: a leadRef for an address no lead has is NotFound", async () => {
  const { outbound, settle } = harness(suite, (request) =>
    path(request) === "/api/v2/leads/list" ? json({ items: [] }) : undefined
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

for (const strategy of ["hash", "mask"] as const) {
  test(`instantly under redact (${strategy}): the address is masked in leadEmail, and the reply still joins to its lead by ref`, async () => {
    const { outbound, requests, settle, unrouted } = redacted(strategy);
    const replies = (await settle(outbound.replies.list())).items;
    const [lead] = (await settle(outbound.leads.list({ email: PERSON }))).items;

    assert.deepEqual(unrouted, []);
    assert.doesNotMatch(JSON.stringify([replies, lead]), /@/u);

    const [first, second] = replies;
    assert.equal(first?.leadRef, PERSON_LEAD);
    assert.equal(second?.leadRef, PERSON_LEAD);
    assert.equal(first?.leadRef, lead?.ref);
    assert.match(first?.leadEmail ?? "", /^redacted:[0-9a-f]{16}$/u);
    assert.equal(first?.leadEmail, lead?.email, "one token per person");
    // The lookup itself reaches Instantly with the real address.
    assert.ok(
      requests.some((request) => (request.body ?? "").includes(PERSON))
    );
  });
}
