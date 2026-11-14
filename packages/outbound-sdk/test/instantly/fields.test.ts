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

test("instantly: unread replies are asked for with is_unread, and without the filter it is not sent", async () => {
  const { outbound, requests, settle } = harness(suite);
  await settle(outbound.replies.list({ unread: true }));
  await settle(outbound.replies.list({ unread: false }));
  await settle(outbound.replies.list());

  assert.deepEqual(
    requests
      .map((request) => new URL(request.url))
      .filter((url) => url.pathname.endsWith("/emails"))
      .map((url) => url.searchParams.get("is_unread")),
    ["true", "false", null]
  );
});

test("instantly: every campaign's totals come from one request, each count from its own field", async () => {
  const { outbound, requests, settle } = harness(suite);

  const stats = await settle(
    outbound.stats({ from: "2026-10-01", scope: "campaign", to: "2026-10-31" })
  );

  const url = new URL(requests[0]?.url ?? "");
  assert.equal(requests.length, 1);
  assert.equal(url.pathname, "/api/v2/campaigns/analytics");
  assert.equal(url.searchParams.get("id"), null, "no id is every campaign");
  assert.equal(url.searchParams.get("start_date"), "2026-10-01");
  assert.equal(url.searchParams.get("end_date"), "2026-10-31");

  const [first, second] = stats.rows;
  assert.equal(
    first?.scopeRef,
    "instantly:client-a:01a1d77f-5e23-7a9a-9112-a6f7089f329f"
  );
  assert.equal(second?.sent, 203);
  assert.deepEqual(
    {
      bounced: first?.bounced,
      clicked: first?.clicked,
      clickedTotal: first?.clickedTotal,
      contacted: first?.contacted,
      opened: first?.opened,
      openedTotal: first?.openedTotal,
      positive: first?.positive,
      replied: first?.replied,
      repliedAuto: first?.repliedAuto,
      sent: first?.sent,
      unsubscribed: first?.unsubscribed,
    },
    {
      bounced: 117,
      clicked: 115,
      clickedTotal: 114,
      contacted: 102,
      opened: 106,
      // open_count is leads who opened on this report, not every open.
      openedTotal: null,
      // The per-campaign report has no count of interested leads.
      positive: null,
      replied: 109,
      repliedAuto: 112,
      sent: 103,
      unsubscribed: 118,
    }
  );
});

test("instantly: every campaign by day is refused before any request", async () => {
  const { outbound, requests, settle } = harness(suite);

  await assert.rejects(
    async () =>
      await settle(
        outbound.stats({ by: "day", retries: 0, scope: "campaign" })
      ),
    /totals only/u
  );
  assert.equal(requests.length, 0);
});

test("instantly: a mailbox's campaigns come from its campaign mappings, page by page", async () => {
  const { outbound, requests, settle } = harness(suite);

  const campaigns = await settle(
    outbound.sender("Person1@Example.com").campaigns.listAll().toArray()
  );

  const paths = requests.map((request) => new URL(request.url).pathname);
  assert.equal(
    paths[0],
    "/api/v2/account-campaign-mappings/Person1%40Example.com",
    "the mailbox's address is the id, percent-encoded"
  );
  assert.deepEqual(
    campaigns.map((campaign) => [
      campaign.sourceId,
      campaign.name,
      campaign.status,
      campaign.createdAt,
    ]),
    [
      [
        "01a1d77f-5e23-7a9a-9112-a6f7089f329f",
        "My First Campaign",
        "active",
        "2026-11-14T00:40:11.043Z",
      ],
      [
        "01a1d77f-5e23-7a9a-9112-a6f7089f3290",
        "Second Campaign",
        "paused",
        "2026-11-13T00:40:11.043Z",
      ],
      [
        "01a1d77f-5e24-7c14-aff0-9be8b7ae4a52",
        "Third Campaign",
        "completed",
        "2026-11-12T00:40:11.043Z",
      ],
    ]
  );

  const paused = await settle(
    outbound.sender("person1@example.com").campaigns.list({ status: "paused" })
  );

  assert.deepEqual(
    paused.items.map((campaign) => campaign.name),
    ["Second Campaign"],
    "the status filter is applied to the mapped status"
  );
});

test("instantly: a campaign with no name is named by its id, never empty", async () => {
  const { outbound, settle } = harness(suite, (request) =>
    new URL(request.url).pathname.endsWith("/campaigns")
      ? Response.json({ items: [{ id: "c-77", status: 1 }] })
      : undefined
  );

  assert.equal(
    (await settle(outbound.campaigns.list())).items[0]?.name,
    "c-77"
  );
});

test("instantly: a webhook says which of the SDK's event types its event becomes", async () => {
  const { outbound, settle } = harness(suite);
  const hooks = await settle(outbound.webhooks.listAll().toArray());
  const byEvent = new Map(hooks.map((hook) => [hook.events[0], hook]));

  assert.deepEqual(byEvent.get("lead_interested")?.eventTypes, [
    "reply.categorized",
  ]);

  const all = byEvent.get("all_events")?.eventTypes ?? [];
  assert.ok(all.includes("reply.received") && all.includes("message.sent"));
  assert.equal(new Set(all).size, all.length, "each type once");
  assert.equal(all.includes("unknown"), false);

  const custom = hooks.find((hook) => hook.events.length === 0);
  assert.deepEqual(
    custom?.eventTypes,
    [],
    "a webhook for a custom lead label has no event type"
  );
});
