// The fields added for people, mailboxes and the inbox, with expected values
// taken from the documented payloads in fixtures/smartlead/.

import assert from "node:assert/strict";
import { test } from "node:test";

import { smartlead } from "../../src/smartlead/index.ts";
import { harness } from "../helpers/adapter-suite.ts";
import { fixture } from "../helpers/fixtures.ts";
import { CAMPAIGN, KEY, suite } from "./suite.ts";

const urlOfLast = (requests: readonly { url: string }[]): URL =>
  new URL(requests.at(-1)?.url ?? "");

test("smartlead: a campaign's lead carries phone, website, location and what its category means", async () => {
  const { outbound, settle } = harness(suite);
  const page = await settle(outbound.campaign(CAMPAIGN).leads.list());
  const [first, second] = page.items;

  assert.equal(first?.phone, "+15550000000", "phone_number");
  assert.equal(first?.website, "https://example.com");
  assert.equal(first?.location, "San Francisco, CA");
  assert.equal(first?.companyLinkedinUrl, null, "company_url is a website");
  assert.equal(first?.interestCategory, null, "lead_category_id is null");
  assert.equal(second?.interest, "Interested", "category 1 by name");
  assert.equal(second?.interestCategory, "positive", "and by sentiment");
});

test("smartlead: a category's meaning survives the cursor to the next page", async () => {
  const { outbound, requests, settle } = harness(suite);

  const leads = await settle(
    outbound.campaign(CAMPAIGN).leads.listAll().toArray()
  );

  assert.equal(
    requests.filter((request) =>
      new URL(request.url).pathname.endsWith("/leads/fetch-categories")
    ).length,
    1,
    "the category list is read once"
  );

  const categorized = leads.filter((lead) => lead.interest !== null);
  assert.ok(categorized.length > 0);

  for (const lead of categorized) {
    assert.notEqual(
      lead.interest === "Interested" ? lead.interestCategory : "positive",
      null,
      "a named category keeps its meaning on every page"
    );
  }
});

test("smartlead: a mailbox carries its provider and tags", async () => {
  const { outbound, settle } = harness(suite);
  const page = await settle(outbound.senders.list({ limit: 2 }));

  assert.deepEqual(
    page.items.map((sender) => [sender.mailProvider, sender.tags]),
    [
      ["google", ["Winners"]],
      ["smtp", ["Winners"]],
    ],
    "GMAIL and SMTP, and tag_name"
  );
});

test("smartlead: an unlisted mailbox type is other, and a missing one is unknown", async () => {
  const [account] = fixture("smartlead", "listEmailAccounts.json") as Record<
    string,
    unknown
  >[];

  const { outbound, settle } = harness(suite, () =>
    Response.json([
      { ...account, id: 1, type: "OUTLOOK" },
      { ...account, id: 2, type: "ZOHO" },
      { ...account, id: 3, tags: undefined, type: undefined },
    ])
  );

  const page = await settle(outbound.senders.list());
  assert.deepEqual(
    page.items.map((sender) => [sender.mailProvider, sender.tags]),
    [
      ["microsoft", ["Winners"]],
      ["other", ["Winners"]],
      [null, []],
    ]
  );
});

test("smartlead: unread replies are picked after fetching, because the inbox has no filter for it", async () => {
  const { outbound, requests, settle } = harness(suite);
  assert.equal(outbound.capabilities["replies.unread"], "client");

  const unread = await settle(outbound.replies.list({ unread: true }));
  assert.ok(
    unread.items.length > 0,
    "is_read is false on the documented threads"
  );
  assert.equal(unread.meta.evidence, "derived");
  assert.equal(
    JSON.stringify(JSON.parse(requests.at(-1)?.body ?? "{}")).includes("read"),
    false,
    "nothing about read state is sent"
  );

  const read = await settle(outbound.replies.list({ unread: false }));
  assert.deepEqual(read.items, [], "none of the documented threads is read");

  const plain = await settle(outbound.replies.list());
  assert.equal(plain.meta.evidence, "exact");
});

test("smartlead: every campaign's totals come from the campaign performance report", async () => {
  const { outbound, requests, settle } = harness(suite);

  const stats = await settle(
    outbound.stats({ from: "2024-01-01", scope: "campaign", to: "2024-01-31" })
  );

  const url = new URL(requests[0]?.url ?? "");
  assert.deepEqual(
    requests.map((request) => new URL(request.url).pathname),
    ["/api/v1/analytics/campaign/overall-stats", "/api/v1/campaigns/"],
    "then the campaign list, once, for every campaign's tracking"
  );
  assert.equal(url.pathname, "/api/v1/analytics/campaign/overall-stats");
  assert.equal(url.searchParams.get("start_date"), "2024-01-01");
  assert.equal(url.searchParams.get("end_date"), "2024-01-31");
  assert.equal(url.searchParams.get("full_data"), "true");
  assert.deepEqual(
    stats.rows.map((row) => [
      row.scopeRef,
      row.sent,
      row.contacted,
      row.opened,
      row.openedTotal,
      row.replied,
      row.positive,
      row.bounced,
    ]),
    [
      ["smartlead:client-a:372", 500, 480, 230, 250, 45, 25, 8],
      ["smartlead:client-a:373", 300, 290, 110, 120, 21, 9, 3],
    ]
  );
});

test("smartlead: every campaign by day is refused before any request", async () => {
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

test("smartlead: a mailbox's campaigns are the campaign list narrowed to the ids the mailbox names", async () => {
  const account = fixture("smartlead", "getEmailAccount.json") as Record<
    string,
    unknown
  >;

  const { outbound, requests, settle } = harness(suite, (request) =>
    new URL(request.url).pathname.endsWith("/email-accounts/123/")
      ? Response.json({ ...account, campaign_ids: [2_710_100, 999] })
      : undefined
  );

  const page = await settle(outbound.sender("123").campaigns.list());
  const [first, second] = requests.map((request) => new URL(request.url));

  assert.equal(first?.pathname, "/api/v1/email-accounts/123/");
  assert.equal(first?.searchParams.get("fetch_campaigns"), "true");
  assert.equal(second?.pathname, "/api/v1/campaigns/");
  assert.equal(requests.length, 2);
  assert.deepEqual(
    page.items.map((campaign) => campaign.sourceId),
    ["2710100"],
    "an id the campaign list does not have is left out"
  );
});

test("smartlead: a mailbox that names no campaigns has none", async () => {
  const { campaign_ids: _ids, ...account } = fixture(
    "smartlead",
    "getEmailAccount.json"
  ) as Record<string, unknown>;

  const { outbound, settle } = harness(suite, (request) =>
    new URL(request.url).pathname.endsWith("/email-accounts/123/")
      ? Response.json(account)
      : undefined
  );

  const page = await settle(outbound.sender("123").campaigns.list());
  assert.deepEqual(page.items, []);
});

const nameless = (id: number) => ({ id, name: null });

test("smartlead: a campaign, list, tag or client with no name is named by its id, never empty", async () => {
  const { outbound, settle } = harness(suite, (request) => {
    const { pathname } = new URL(request.url);

    if (pathname.endsWith("/campaigns/")) {
      return Response.json([nameless(11)]);
    }

    if (pathname.endsWith("/lead-list/")) {
      return Response.json({ data: [nameless(12)], ok: true });
    }

    if (pathname.endsWith("/email-accounts/tags")) {
      return Response.json([nameless(13)]);
    }

    return pathname.endsWith("/client/")
      ? Response.json([nameless(14)])
      : undefined;
  });

  assert.equal((await settle(outbound.campaigns.list())).items[0]?.name, "11");
  assert.equal((await settle(outbound.lists.list())).items[0]?.name, "12");
  assert.equal((await settle(outbound.tags.list())).items[0]?.name, "13");
  assert.equal((await settle(outbound.workspaces.list())).items[0]?.name, "14");
});

test("smartlead: a named custom field fills a field the vendor has none for, and the grade says so", async () => {
  const mapped: typeof suite = {
    ...suite,
    make: () =>
      smartlead({
        apiKey: KEY,
        leadFields: { company: "industry", title: "job_title" },
        workspaceId: "client-a",
      }),
  };

  const { outbound, settle } = harness(mapped);
  const lead = await settle(outbound.leads.get("789"));

  assert.equal(lead.title, "CEO", "custom_fields.job_title");
  assert.equal(
    lead.company,
    "Example Co",
    "the vendor's own company_name wins over a mapped field"
  );
  assert.equal(outbound.fields.lead.title, "derived");
  assert.equal(outbound.fields.lead.company, "exact");

  const listed = await settle(outbound.campaign("372").leads.list());
  assert.equal(listed.items[0]?.title, "CEO", "on listings too");

  const plain = harness(suite);
  const unmapped = await plain.settle(plain.outbound.leads.get("789"));
  assert.equal(unmapped.title, null, "nothing is guessed without the option");
  assert.equal(plain.outbound.fields.lead.title, false);
});

test("smartlead: a mapped custom field that is missing or blank leaves the field empty", async () => {
  const mapped: typeof suite = {
    ...suite,
    make: () =>
      smartlead({
        apiKey: KEY,
        leadFields: { title: "role" },
        workspaceId: "client-a",
      }),
  };

  const { outbound, settle } = harness(mapped);
  assert.equal((await settle(outbound.leads.get("789"))).title, null);
});

test("smartlead: a webhook says which of the SDK's event types its events become", async () => {
  const { outbound, settle } = harness(suite);
  const hooks = await settle(outbound.campaign(CAMPAIGN).webhooks.list());

  assert.deepEqual(
    hooks.items.map((hook) => [hook.events, hook.eventTypes]),
    [
      [["LEAD_CATEGORY_UPDATED"], ["reply.categorized"]],
      [
        ["EMAIL_REPLY", "EMAIL_BOUNCE"],
        ["message.bounced", "reply.received"],
      ],
    ]
  );
});

test("smartlead: one list by id is read from its own endpoint", async () => {
  const { outbound, requests, settle } = harness(suite);
  const list = await settle(outbound.lists.get("500"));

  assert.equal(urlOfLast(requests).pathname, "/api/v1/lead-list/500");
  assert.equal(list.name, "Q1 2025 Enterprise Prospects");
  assert.equal(list.size, 1250, "lead_count");
});

test("smartlead: one webhook by id names its events as the keys of a map", async () => {
  const { outbound, requests, settle } = harness(suite);
  const hook = await settle(outbound.webhooks.get("456"));

  assert.equal(urlOfLast(requests).pathname, "/api/v1/webhook/456");
  assert.deepEqual(hook.events, [
    "EMAIL_SENT",
    "EMAIL_OPEN",
    "EMAIL_LINK_CLICK",
    "EMAIL_REPLY",
  ]);
  assert.deepEqual(hook.eventTypes, [
    "message.clicked",
    "message.opened",
    "message.sent",
    "reply.received",
  ]);
  assert.deepEqual(hook.campaignRefs, ["smartlead:client-a:123"]);
});

test("smartlead: an event switched off in a webhook's map is not one of its events", async () => {
  const { outbound, settle } = harness(suite, (request) =>
    new URL(request.url).pathname.endsWith("/webhook/456")
      ? Response.json({
          data: {
            event_type_map: { EMAIL_OPEN: false, EMAIL_REPLY: true },
            id: 456,
            webhook_url: "https://hooks.example.com/smartlead",
          },
          ok: true,
        })
      : undefined
  );

  const hook = await settle(outbound.webhooks.get("456"));
  assert.deepEqual(hook.events, ["EMAIL_REPLY"]);
  assert.deepEqual(hook.campaignRefs, [], "it names no campaign");
});

test("smartlead: a block entry with no value is left out, not returned empty", async () => {
  const { outbound, settle } = harness(suite, (request) =>
    new URL(request.url).pathname.endsWith("/get-domain-block-list")
      ? Response.json([
          { email_or_domain: null, id: 1 },
          { email_or_domain: "Person9@Example.com", id: 2 },
        ])
      : undefined
  );

  const page = await settle(outbound.blocklist.list());
  assert.deepEqual(
    page.items.map((entry) => [entry.sourceId, entry.kind, entry.value]),
    [["2", "email", "person9@example.com"]]
  );
});

test("smartlead: a mailbox's passwords are stripped from raw at every depth", async () => {
  const account = fixture("smartlead", "getEmailAccount.json") as Record<
    string,
    unknown
  >;

  const { outbound, settle } = harness(suite, (request) =>
    new URL(request.url).pathname.endsWith("/email-accounts/123/")
      ? Response.json({
          ...account,
          imap: { imap_password: "nested-secret", host: "imap.example.com" },
          oauth: [{ refresh_token: "another-secret", scope: "mail" }],
        })
      : undefined
  );

  const sender = await settle(outbound.senders.get("123"));
  const kept = JSON.stringify(sender.raw);

  assert.equal(kept.includes("nested-secret"), false);
  assert.equal(kept.includes("another-secret"), false);
  assert.equal(/password|token/iu.test(kept), false);
  assert.ok(kept.includes("imap.example.com"), "the rest is kept");
});

test("smartlead: a lead's progress and what came back from it are separate", async () => {
  const page = fixture("smartlead", "listCampaignLeads.json") as {
    data: { lead: Record<string, unknown>; status: string }[];
  };

  const [row] = page.data;
  assert.ok(row);

  const cases = [
    { is_unsubscribed: false, status: "INPROGRESS" },
    { is_unsubscribed: false, status: "BLOCKED" },
    { is_unsubscribed: true, status: "COMPLETED" },
    { is_unsubscribed: false, status: "SOMETHING_NEW" },
  ];

  const { outbound, settle } = harness(suite, (request) =>
    /\/campaigns\/\d+\/leads$/u.test(new URL(request.url).pathname)
      ? Response.json({
          ...page,
          data: cases.map((each, index) => ({
            ...row,
            lead: {
              ...row.lead,
              id: index + 1,
              is_unsubscribed: each.is_unsubscribed,
            },
            status: each.status,
          })),
          total_leads: cases.length,
        })
      : undefined
  );

  const leads = await settle(outbound.campaign(CAMPAIGN).leads.list());
  assert.deepEqual(
    leads.items.map((each) => [
      each.status,
      each.progress,
      each.bounced,
      each.unsubscribed,
      each.replied,
    ]),
    [
      ["active", "active", false, false, null],
      ["bounced", "unknown", true, false, null],
      ["unsubscribed", "completed", false, true, null],
      ["unknown", "unknown", false, false, null],
    ],
    "a campaign's lead row does not say whether the lead replied"
  );
});

test("smartlead: a campaign's progress is the lead counts of its analytics", async () => {
  const { outbound, requests, settle } = harness(suite, (request) =>
    /\/campaigns\/\d+\/analytics$/u.test(new URL(request.url).pathname)
      ? Response.json({
          campaign_lead_stats: {
            blocked: 1,
            completed: 2,
            inprogress: 3,
            notStarted: 4,
            stopped: 5,
            total: 15,
          },
          id: 372,
        })
      : undefined
  );

  const progress = await settle(outbound.campaign(CAMPAIGN).progress());

  assert.equal(urlOfLast(requests).pathname, "/api/v1/campaigns/372/analytics");
  assert.deepEqual(
    {
      blocked: progress.blocked,
      completed: progress.completed,
      failed: progress.failed,
      inProgress: progress.inProgress,
      leads: progress.leads,
      notStarted: progress.notStarted,
      skipped: progress.skipped,
      stopped: progress.stopped,
    },
    {
      blocked: 1,
      completed: 2,
      failed: null,
      inProgress: 3,
      leads: 15,
      notStarted: 4,
      skipped: null,
      stopped: 5,
    },
    "each count from its own field"
  );
});

test("smartlead: placement tests come from SmartDelivery, on its own host with the same key", async () => {
  const { outbound, requests, settle } = harness(suite);
  const page = await settle(outbound.placementTests.list());
  const url = urlOfLast(requests);

  assert.equal(url.origin, "https://smartdelivery.smartlead.ai");
  assert.equal(url.pathname, "/api/v1/spam-test/report");
  assert.equal(url.searchParams.get("api_key"), KEY);
  assert.equal(requests.at(-1)?.method, "POST");
  assert.deepEqual(
    page.items.map((each) => [
      each.sourceId,
      each.name,
      each.status,
      each.kind,
      each.startsAt,
      each.endsAt,
    ]),
    [
      [
        "test_001",
        "Gmail Inbox Placement Test",
        "active",
        "automated",
        "2026-03-10T09:00:00.000Z",
        "2026-06-10T09:00:00.000Z",
      ],
      [
        "test_002",
        "Outlook Spam Filter Test",
        "completed",
        "one_time",
        "2026-03-14T14:00:00.000Z",
        "2026-03-20T14:00:00.000Z",
      ],
    ],
    "manual is a one-time test"
  );
  assert.equal(page.items[0]?.campaignRef, null, "the list names no campaign");
});
