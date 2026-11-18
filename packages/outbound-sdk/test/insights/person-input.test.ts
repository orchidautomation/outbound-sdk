// OUT-138: every tool and insight that takes a person accepts the lead ref
// another read returned, an email address or a LinkedIn profile URL. Live, an
// Instantly reply's leadRef (`instantly:<workspace>:<address>`) was taken
// for an address and sent as one, and Instantly answered 400.

import assert from "node:assert/strict";
import { test } from "node:test";

import { combine } from "../../src/combine/index.ts";
import { identity } from "../../src/identity/index.ts";
import {
  createOutbound,
  MemoryRateLimitStore,
  OutboundError,
} from "../../src/index.ts";
import type { Adapter } from "../../src/index.ts";
import { insights } from "../../src/insights/index.ts";
import { memory } from "../../src/memory/index.ts";
import { createTools } from "../../src/tools/index.ts";
import { fixtureHandler } from "../helpers/adapter-suite.ts";
import type { AdapterSuite } from "../helpers/adapter-suite.ts";
import { createClock } from "../helpers/clock.ts";
import { createFetch } from "../helpers/http.ts";
import type { RecordedRequest } from "../helpers/http.ts";
import { suite as heyreach } from "../heyreach/suite.ts";
import { suite as instantly } from "../instantly/suite.ts";
import { EMAIL_TOOL } from "./helpers.ts";

// listReplies.json, as Instantly sends it: the reply names its lead by address.
const REPLIER = "person6@example.com";
const REPLY_REF = `instantly:client-a:${REPLIER}`;
const REPLIER_LEAD = "instantly:client-a:01a1d77f-5e65-78a7-8eb0-0216d691e16c";

const PROFILE_REF =
  "heyreach:client-a:https://www.linkedin.com/in/example-person-1";

const instanceOf = (suites: readonly AdapterSuite[], adapter: Adapter) => {
  const clock = createClock();
  const unrouted: string[] = [];
  const http = createFetch(fixtureHandler([...suites], unrouted));

  const outbound = createOutbound({
    adapter,
    fetch: http.fetch,
    plugins: [insights(), identity()],
    rateLimitStore: new MemoryRateLimitStore(),
    runtime: clock.runtime,
    share: 1,
  });

  return { outbound, requests: http.requests, settle: clock.settle, unrouted };
};

const onInstantly = () => instanceOf([instantly], instantly.make());

const onBoth = () =>
  instanceOf(
    [instantly, heyreach],
    combine([instantly.make(), heyreach.make()])
  );

/** The addresses each lookup by email sent to Instantly. */
const contactsSent = (requests: readonly RecordedRequest[]): string[] =>
  requests.flatMap((request) =>
    new URL(request.url).pathname === "/api/v2/leads/list"
      ? ((JSON.parse(request.body ?? "{}") as { contacts?: string[] })
          .contacts ?? [])
      : []
  );

const invalid = (pattern: RegExp) => (error: unknown) =>
  OutboundError.is(error) &&
  error.code === "Invalid" &&
  pattern.test(error.message);

test("instantly: person_summary takes a reply's leadRef, the lead's own ref", async () => {
  const { outbound, requests, settle, unrouted } = onInstantly();
  const replies = await settle(outbound.replies.list());

  const reply = replies.items.find((each) => each.leadEmail === REPLIER);

  assert.equal(reply?.leadRef, REPLIER_LEAD);
  requests.length = 0;

  const result = await settle(
    outbound.insights.personSummary({ lead_ref: reply?.leadRef ?? "" })
  );

  // It is read like any lead's ref: by id first, for the address.
  assert.equal(result.data.found, true);
  assert.equal(
    new URL(requests[0]?.url ?? "").pathname,
    "/api/v2/leads/01a1d77f-5e65-78a7-8eb0-0216d691e16c"
  );
  assert.deepEqual(unrouted, []);
});

test("instantly: person_summary takes a ref that names its lead by address, as refs did before OUT-149, and asks for the address alone", async () => {
  const { outbound, requests, settle, unrouted } = onInstantly();

  for (const input of [{ person: REPLY_REF }, { lead_ref: REPLY_REF }]) {
    const first = requests.length;
    // oxlint-disable-next-line no-await-in-loop -- one input at a time keeps the requests apart.
    const result = await settle(outbound.insights.personSummary(input));

    // The ref's address is read locally: the first request is the lookup by
    // that address, not a read of the lead by id.
    assert.equal(
      new URL(requests[first]?.url ?? "").pathname,
      "/api/v2/leads/list"
    );

    assert.equal(result.data.found, true, JSON.stringify(input));
    assert.ok(
      result.data.identifiers.includes(`email:${REPLIER}`),
      JSON.stringify(result.data.identifiers)
    );
  }

  // Only the bare address is sent where Instantly checks for an email format.
  assert.deepEqual([...new Set(contactsSent(requests))], [REPLIER]);
  assert.deepEqual(unrouted, []);
});

test("instantly: a lead record's ref is read once for its address, then looked up by it", async () => {
  const { outbound, requests, settle } = onInstantly();
  const [lead] = (await settle(outbound.leads.list())).items;
  requests.length = 0;

  const result = await settle(
    outbound.insights.personSummary({ lead_ref: lead?.ref ?? "" })
  );

  assert.equal(result.data.found, true);
  assert.equal(
    new URL(requests[0]?.url ?? "").pathname,
    `/api/v2/leads/${lead?.sourceId ?? ""}`
  );
  assert.ok(contactsSent(requests).every((address) => !address.includes(":")));
});

test("person_summary refuses a value in the wrong field, or several, before any request", async () => {
  const { outbound, requests, settle } = onInstantly();

  const cases: [Record<string, string>, RegExp][] = [
    [
      { lead_ref: REPLIER },
      /lead_ref takes a lead ref .*pass ".+" as email instead/u,
    ],
    [
      { email: REPLY_REF },
      /email takes an email address; ".*" is a lead ref, so pass it as lead_ref/u,
    ],
    [{ linkedin_url: REPLIER }, /linkedin_url takes a LinkedIn profile URL/u],
    [
      { email: REPLIER, lead_ref: REPLY_REF },
      /needs exactly one of lead_ref, email, linkedin_url or person.*got lead_ref and email/u,
    ],
    [{}, /needs exactly one of lead_ref, email, linkedin_url or person/u],
    [{ person: "acme.com" }, /is a company domain, not a person/u],
    [
      { person: "jane" },
      /"jane" is not an email address, a LinkedIn profile URL or a lead ref/u,
    ],
    // A ref of a tool or workspace this instance does not read.
    [
      { lead_ref: PROFILE_REF },
      /is a lead ref from heyreach workspace client-a, but this instance reads instantly workspace client-a\. .*--provider heyreach/u,
    ],
    [
      { person: `instantly:client-b:${REPLIER}` },
      /from instantly workspace client-b/u,
    ],
  ];

  for (const [input, pattern] of cases) {
    // oxlint-disable-next-line no-await-in-loop -- one case at a time keeps the failing one in the message.
    await assert.rejects(
      settle(outbound.insights.personSummary(input)),
      invalid(pattern),
      JSON.stringify(input)
    );
  }

  assert.equal(requests.length, 0);
});

test("--provider all: a ref's provider picks the tool, and one no tool reads is refused", async () => {
  const { outbound, requests, settle, unrouted } = onBoth();

  const fromInstantly = await settle(
    outbound.insights.personSummary({ lead_ref: REPLY_REF })
  );

  assert.equal(fromInstantly.data.found, true);
  assert.deepEqual([...new Set(contactsSent(requests))], [REPLIER]);

  // A HeyReach ref is its lead's profile URL, so it is read locally too.
  const fromHeyReach = await settle(
    outbound.insights.personSummary({ lead_ref: PROFILE_REF })
  );

  assert.equal(fromHeyReach.data.found, true);
  assert.ok(
    fromHeyReach.data.identifiers.includes("linkedin:example-person-1")
  );
  assert.ok(
    fromHeyReach.data.campaigns.every((each) => each.provider === "heyreach")
  );
  assert.deepEqual(unrouted, []);

  requests.length = 0;

  await assert.rejects(
    settle(
      outbound.insights.personSummary({ lead_ref: "smartlead:client-a:123" })
    ),
    invalid(
      /from smartlead workspace client-a, but no tool on this combined instance is that one/u
    )
  );
  assert.equal(requests.length, 0);
});

test("cross_channel_lead takes the same fields: a reply's leadRef, and refuses a mismatch", async () => {
  const { outbound, requests, settle } = onInstantly();

  const tool = createTools(outbound).find(
    (each) => each.name === "cross_channel_lead"
  );

  assert.ok(tool !== undefined);

  const result = await settle(tool.call({ lead_ref: REPLY_REF }));

  assert.ok(result.ok, JSON.stringify(result));
  assert.equal((result.data as { found: boolean }).found, true);
  assert.deepEqual([...new Set(contactsSent(requests))], [REPLIER]);

  requests.length = 0;

  const wrong = await settle(tool.call({ email: REPLY_REF }));

  assert.ok(!wrong.ok);
  assert.equal(wrong.error.code, "Invalid");
  assert.match(wrong.error.message, /is a lead ref, so pass it as lead_ref/u);
  assert.equal(requests.length, 0);
});

test("person() on the identity plugin reads a ref of another tool as nothing it can link", async () => {
  const { outbound, requests, settle } = onInstantly();

  await assert.rejects(
    settle(outbound.person(PROFILE_REF)),
    invalid(/is a lead ref from heyreach workspace client-a/u)
  );
  assert.equal(requests.length, 0);
});

test("person() reads a lead ref by id for its identifiers, and says when the lead has none", async () => {
  const { outbound, settle } = onInstantly();
  const [lead] = (await settle(outbound.leads.list())).items;
  const person = await settle(outbound.person(lead?.ref ?? ""));

  assert.equal(person.found, true);
  assert.equal(person.key, `email:${lead?.email ?? ""}`);

  const bare = createOutbound({
    adapter: memory({
      data: {
        ...EMAIL_TOOL,
        leads: [...(EMAIL_TOOL.leads ?? []), { campaignId: "c1", id: "l9" }],
      },
      name: "mailtool",
      workspaceId: "agency",
    }),
    plugins: [identity()],
  });

  const nameless = (await bare.leads.listAll().toArray()).find(
    (each) => each.email === null && each.linkedinUrl === null
  );

  assert.ok(nameless !== undefined, "the fixture holds a lead with neither");
  await assert.rejects(
    bare.person(nameless?.ref ?? ""),
    (error) =>
      OutboundError.is(error) &&
      error.code === "NotFound" &&
      /has no email address or LinkedIn profile/u.test(error.message)
  );
});
