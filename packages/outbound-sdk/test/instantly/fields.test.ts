// The fields added for people, mailboxes and the inbox, with expected values
// taken from the documented payloads in fixtures/instantly/.

import assert from "node:assert/strict";
import { test } from "node:test";

import { harness } from "../helpers/adapter-suite.ts";
import { fixture } from "../helpers/fixtures.ts";
import { LEAD, suite } from "./suite.ts";

test("instantly: a lead carries its phone, website and what its interest status means", async () => {
  const { outbound, settle } = harness(suite);
  const lead = await settle(outbound.leads.get(LEAD));

  assert.equal(lead.phone, "+1234567890");
  assert.equal(lead.website, "https://example.com", "website wins");
  assert.equal(lead.interest, "Meeting Booked", "lt_interest_status 2");
  assert.equal(lead.interestCategory, "positive");
  assert.equal(lead.location, null, "Instantly has no location field");
  assert.equal(lead.companyLinkedinUrl, null);
});

test("instantly: a lead with no website falls back to its company domain, and no label means no category", async () => {
  const {
    lt_interest_status: _status,
    website: _website,
    ...rest
  } = fixture("instantly", "getLead.json") as Record<string, unknown>;

  const { outbound, settle } = harness(suite, (request) =>
    new URL(request.url).pathname.endsWith(`/leads/${LEAD}`)
      ? Response.json(rest)
      : undefined
  );

  const lead = await settle(outbound.leads.get(LEAD));
  assert.equal(lead.website, "example.com", "company_domain");
  assert.equal(lead.interest, null);
  assert.equal(lead.interestCategory, null);
});

test("instantly: the mailbox list asks for tags and reads the provider", async () => {
  const { outbound, requests, settle } = harness(suite);
  const page = await settle(outbound.senders.list());

  assert.equal(
    new URL(requests[0]?.url ?? "").searchParams.get("include_tags"),
    "true"
  );
  assert.deepEqual(
    page.items.map((sender) => [sender.mailProvider, sender.tags]),
    [
      ["google", []],
      ["google", ["Warm pool"]],
    ],
    "provider_code 2 is Google"
  );
});

test("instantly: each provider code has one meaning, and an unknown one has none", async () => {
  const [account] = (
    fixture("instantly", "listAccounts.json") as {
      items: Record<string, unknown>[];
    }
  ).items;

  const codes = [1, 2, 3, 4, 8, 11, 99];

  const { outbound, settle } = harness(suite, () =>
    Response.json({
      items: codes.map((code) => ({
        ...account,
        email: `box${code}@example.com`,
        provider_code: code,
      })),
    })
  );

  const page = await settle(outbound.senders.list());
  assert.deepEqual(
    page.items.map((sender) => sender.mailProvider),
    ["smtp", "google", "microsoft", "other", "other", "other", null]
  );
});

test("instantly: a reply says whether it is unread", async () => {
  const { outbound, settle } = harness(suite);
  const page = await settle(outbound.replies.list());
  assert.equal(page.items[0]?.unread, true, "is_unread 1");

  const read = harness(suite, () =>
    Response.json({
      items: [
        { ...(page.items[0]?.raw as object), is_unread: 0 },
        { ...(page.items[0]?.raw as object), id: "other", is_unread: null },
      ],
    })
  );

  const again = await read.settle(read.outbound.replies.list());
  assert.deepEqual(
    again.items.map((reply) => reply.unread),
    [false, null],
    "0 is read, and a missing flag is unknown"
  );
});
