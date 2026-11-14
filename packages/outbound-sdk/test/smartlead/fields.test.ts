// The fields added for people, mailboxes and the inbox, with expected values
// taken from the documented payloads in fixtures/smartlead/.

import assert from "node:assert/strict";
import { test } from "node:test";

import { harness } from "../helpers/adapter-suite.ts";
import { fixture } from "../helpers/fixtures.ts";
import { CAMPAIGN, suite } from "./suite.ts";

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
  assert.equal(requests.length, 1);
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
