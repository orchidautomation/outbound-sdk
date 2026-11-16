// The fields added for people, mailboxes and the inbox, with expected values
// taken from the documented payloads in fixtures/instantly/.

import assert from "node:assert/strict";
import { test } from "node:test";

import { leadSchema } from "../../src/index.ts";
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

test("instantly: every campaign's totals come from one report and the campaign listing, each count from its own field", async () => {
  const { outbound, requests, settle } = harness(suite);

  const stats = await settle(
    outbound.stats({ from: "2026-10-01", scope: "campaign", to: "2026-10-31" })
  );

  const url = new URL(requests[0]?.url ?? "");
  assert.deepEqual(
    requests.map((request) => new URL(request.url).pathname),
    ["/api/v2/campaigns/analytics", "/api/v2/campaigns"],
    "the listing is read once for every campaign's tracking settings"
  );
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
      contacted: 104,
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

test("instantly: one list by id has a size, from its verification statistics", async () => {
  const { outbound, requests, settle } = harness(suite);
  const id = "01a1d77f-5e53-7eb1-ad45-7031e944ef51";
  const list = await settle(outbound.lists.get(id));

  assert.deepEqual(
    requests.map((request) => new URL(request.url).pathname),
    [`/api/v2/lead-lists/${id}`, `/api/v2/lead-lists/${id}/verification-stats`]
  );
  assert.equal(list.name, "My Lead List");
  assert.equal(list.size, 42, "total_leads");
  assert.equal((await settle(outbound.list(id).get())).size, 42);

  const listed = await settle(outbound.lists.list());
  assert.equal(listed.items[0]?.size, null, "the listing carries no count");
});

test("instantly: one webhook by id is the same record the list returns, without its headers", async () => {
  const { outbound, settle } = harness(suite);
  const id = "01a1d77f-5ea4-7b53-a085-00338a94f591";
  const hook = await settle(outbound.webhooks.get(id));

  assert.equal(hook.sourceId, id);
  assert.deepEqual(hook.eventTypes, ["reply.categorized"]);
  assert.equal(
    JSON.stringify(hook.raw).includes("headers"),
    false,
    "delivery headers can carry a credential and are not kept"
  );
});

test("instantly: a block entry with no value is left out, not returned empty", async () => {
  const { outbound, settle } = harness(suite, (request) =>
    new URL(request.url).pathname.endsWith("/block-lists-entries")
      ? Response.json({
          items: [
            { bl_value: "  ", id: "b1", is_domain: false },
            { bl_value: "Example.COM", id: "b2", is_domain: true },
            { id: "b3" },
          ],
        })
      : undefined
  );

  const page = await settle(outbound.blocklist.list());
  assert.deepEqual(
    page.items.map((entry) => [entry.sourceId, entry.kind, entry.value]),
    [["b2", "domain", "example.com"]]
  );
});

test("instantly: a lead's status code is its progress or its outcome, and replies are their own flag", async () => {
  const [lead] = (
    fixture("instantly", "listLeads.json") as {
      items: Record<string, unknown>[];
    }
  ).items;

  const cases = [
    { email_reply_count: 0, status: 1 },
    { email_reply_count: 0, status: 3 },
    { email_reply_count: 2, status: 3 },
    { email_reply_count: 0, status: -1 },
    { email_reply_count: 1, status: -2 },
    { email_reply_count: 0, status: -3 },
    { email_reply_count: null, status: null },
  ];

  const { outbound, settle } = harness(suite, (request) =>
    new URL(request.url).pathname.endsWith("/leads/list")
      ? Response.json({
          items: cases.map((each, index) => ({
            ...lead,
            ...each,
            id: `lead-${index}`,
          })),
        })
      : undefined
  );

  const page = await settle(outbound.leads.list());
  assert.deepEqual(
    page.items.map((each) => [
      each.status,
      each.progress,
      each.replied,
      each.bounced,
      each.unsubscribed,
    ]),
    [
      ["active", "active", false, false, false],
      ["completed", "completed", false, false, false],
      ["replied", "completed", true, false, false],
      ["bounced", "unknown", false, true, false],
      ["unsubscribed", "unknown", true, false, true],
      // -3 is "Skipped" in the reference: never sent, not waiting to start.
      ["skipped", "skipped", false, false, false],
      ["unknown", "unknown", null, null, null],
    ],
    "an unsubscribe outranks a reply, and a missing code is unknown, not false"
  );
});

test("instantly: a lead's esp_code is its own mail provider, and In Queue or Not Found is unknown", async () => {
  const [lead] = (
    fixture("instantly", "listLeads.json") as {
      items: Record<string, unknown>[];
    }
  ).items;

  // The reference's esp_code values (api_v2.json, read 2026-11-16).
  const codes = [1, 2, 3, 9, 999, 0, 1000, 4, null];

  const { outbound, settle } = harness(suite, (request) =>
    new URL(request.url).pathname.endsWith("/leads/list")
      ? Response.json({
          items: codes.map((esp_code, index) => ({
            ...lead,
            esp_code,
            id: `lead-${index}`,
          })),
        })
      : undefined
  );

  const page = await settle(outbound.leads.list());
  assert.deepEqual(
    page.items.map((each) => each.recipientMailProvider),
    [
      "google",
      "microsoft",
      // Zoho, Yahoo and Other.
      "other",
      "other",
      "other",
      // In Queue, Not Found, a code the reference does not list, and none.
      null,
      null,
      null,
      null,
    ]
  );
});

test("a lead without recipientMailProvider, stored before the field existed, still matches the schema; an unlisted provider does not", async () => {
  const { outbound, settle } = harness(suite);
  const lead = await settle(outbound.leads.get(LEAD));
  const { recipientMailProvider: _provider, ...older } = lead;

  assert.equal(leadSchema.safeParse(older).success, true, "absent");
  assert.equal(
    leadSchema.safeParse({ ...older, recipientMailProvider: null }).success,
    true,
    "null"
  );
  assert.equal(
    leadSchema.safeParse({ ...older, recipientMailProvider: "google" }).success,
    true
  );
  assert.equal(
    leadSchema.safeParse({ ...older, recipientMailProvider: "yahoo" }).success,
    false,
    "only google, microsoft and other are values"
  );
});

test("instantly: a campaign's progress is its lead count and its finished leads, and nothing else", async () => {
  const { outbound, requests, settle } = harness(suite);
  const id = "01a1d77f-5e23-7a9a-9112-a6f7089f329f";
  const progress = await settle(outbound.campaign(id).progress());
  const url = new URL(requests[0]?.url ?? "");

  assert.equal(url.pathname, "/api/v2/campaigns/analytics");
  assert.equal(url.searchParams.get("id"), id);
  assert.equal(progress.leads, 101, "leads_count");
  assert.equal(progress.completed, 119, "completed_count");
  assert.deepEqual(
    [
      progress.notStarted,
      progress.inProgress,
      progress.stopped,
      progress.failed,
      progress.blocked,
    ],
    [null, null, null, null, null],
    "the report does not split the rest"
  );

  const none = harness(suite, () => Response.json([]));
  await assert.rejects(
    async () => await none.settle(none.outbound.campaign(id).progress()),
    /was not found/u
  );
});

test("instantly: placement tests are listed page by page, with status, kind and campaign", async () => {
  const { outbound, requests, settle } = harness(suite);
  const tests = await settle(outbound.placementTests.listAll().toArray());

  assert.equal(
    new URL(requests[0]?.url ?? "").pathname,
    "/api/v2/inbox-placement-tests"
  );
  assert.deepEqual(
    tests.map((each) => [
      each.name,
      each.status,
      each.kind,
      each.campaignRef,
      each.createdAt,
      each.nextRunAt,
    ]),
    [
      [
        "Weekly placement check",
        "active",
        "automated",
        "instantly:client-a:01a1d77f-5e23-7a9a-9112-a6f7089f329f",
        "2026-11-01T09:00:00.000Z",
        "2026-11-15T09:00:00.000Z",
      ],
      [
        "Launch check",
        "completed",
        "one_time",
        null,
        "2026-11-02T09:00:00.000Z",
        null,
      ],
      [
        "Paused check",
        "paused",
        "automated",
        null,
        "2026-11-03T09:00:00.000Z",
        null,
      ],
    ]
  );
  assert.equal(
    tests[0]?.startsAt,
    null,
    "Instantly gives a test no start date"
  );
});
