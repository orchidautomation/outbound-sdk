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
