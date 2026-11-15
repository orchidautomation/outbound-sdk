import assert from "node:assert/strict";
import { test } from "node:test";

import { harness } from "../helpers/adapter-suite.ts";
import { fixture } from "../helpers/fixtures.ts";
import type { RecordedRequest } from "../helpers/http.ts";
import { API, CAMPAIGN, LEAD, suite, urlOf } from "./suite.ts";

const pathOf = (request: RecordedRequest): string => urlOf(request).pathname;

test("smartlead: leads of a campaign page by offset and map the documented fields", async () => {
  const { outbound, requests, settle } = harness(suite);

  const leads = await settle(
    outbound.campaign(CAMPAIGN).leads.listAll({ limit: 500 }).toArray()
  );

  assert.deepEqual(
    requests.map((request) => [
      pathOf(request),
      urlOf(request).searchParams.get("offset"),
      urlOf(request).searchParams.get("limit"),
    ]),
    [
      [`${API}/leads/fetch-categories`, null, null],
      [`${API}/campaigns/372/leads`, "0", "100"],
      [`${API}/campaigns/372/leads`, "2", "100"],
    ],
    "the category names are read once, limit is clamped to 100 and total_leads decides the next offset"
  );
  assert.deepEqual(
    leads.map((lead) => lead.interest),
    [null, "Interested", null],
    "lead_category_id 1 is named by the category list"
  );
  assert.deepEqual(leads[1]?.tags, [], "a listing carries no lead tags");
  assert.equal(leads[1]?.engagement, null);
  assert.deepEqual(
    leads.map((lead) => [lead.sourceId, lead.email, lead.status]),
    [
      ["2995276770", "person1@example.com", "active"],
      ["2995276771", "person2@example.com", "completed"],
      ["2995276772", "person3@example.com", "active"],
    ]
  );
  const [lead] = leads;
  assert.equal(lead?.campaignRef, "smartlead:client-a:372");
  assert.equal(lead?.firstName, "Alex");
  assert.equal(lead?.lastName, "Example");
  assert.equal(lead?.company, "Example Co");
  assert.equal(
    lead?.linkedinUrl,
    "https://www.linkedin.com/in/example-person-1"
  );
  assert.equal(lead?.createdAt, "2025-11-25T12:54:54.000Z");
  assert.equal(lead?.title, null, "Smartlead has no title field");
  assert.deepEqual(lead?.custom, { industry: "Technology", job_title: "CEO" });
  assert.equal(
    (lead?.raw as { campaign_lead_map_id: number } | undefined)
      ?.campaign_lead_map_id,
    2_433_664_091
  );
});

test("smartlead: every documented lead status maps to a status", async () => {
  const expected = [
    ["STARTED", false, "active"],
    ["INPROGRESS", false, "active"],
    ["COMPLETED", false, "completed"],
    ["PAUSED", false, "paused"],
    ["STOPPED", false, "paused"],
    ["BLOCKED", false, "bounced"],
    ["XXX", false, "unknown"],
    ["INPROGRESS", true, "unsubscribed"],
  ] as const;

  for (const [vendor, unsubscribed, status] of expected) {
    const { outbound, settle } = harness(suite, () =>
      Response.json({
        data: [
          {
            created_at: "2025-11-25T12:54:54.000Z",
            lead: {
              email: " Person1@Example.com ",
              id: 7,
              is_unsubscribed: unsubscribed,
            },
            status: vendor,
          },
        ],
        // A number in the older documentation.
        total_leads: 1,
      })
    );

    const page = await settle(outbound.campaign(CAMPAIGN).leads.list());
    assert.equal(page.items[0]?.status, status, vendor);
    assert.equal(page.items[0]?.email, "person1@example.com");
    assert.equal(page.complete, true);
  }
});

const leadRow = (id: number) => ({ lead: { id }, status: "STARTED" });

test("smartlead: without a total, a full page of leads means there may be more", async () => {
  const { outbound, requests, settle } = harness(suite, (request) =>
    Response.json({
      data:
        urlOf(request).searchParams.get("offset") === "0"
          ? [leadRow(1), leadRow(2)]
          : [leadRow(3)],
    })
  );

  const leads = await settle(
    outbound.campaign(CAMPAIGN).leads.listAll({ limit: 2 }).toArray()
  );

  assert.deepEqual(
    leads.map((lead) => lead.sourceId),
    ["1", "2", "3"]
  );
  assert.equal(requests.length, 3, "the category list and two pages");
});

test("smartlead: leads without a campaign walk every campaign in turn", async () => {
  const other = {
    data: [
      {
        campaign_lead_map_id: 9,
        created_at: "2025-12-01T00:00:00.000Z",
        lead: { email: "person4@example.com", id: 4 },
        status: "PAUSED",
      },
    ],
    total_leads: "1",
  };

  const { outbound, requests, settle } = harness(suite, (request) =>
    pathOf(request) === `${API}/campaigns/2710100/leads`
      ? Response.json(other)
      : undefined
  );

  const walk = outbound.leads.listAll();
  const leads = await settle(walk.toArray());

  assert.deepEqual(
    requests.map((request) => [
      pathOf(request),
      urlOf(request).searchParams.get("offset"),
    ]),
    [
      [`${API}/campaigns/`, null],
      [`${API}/leads/fetch-categories`, null],
      [`${API}/campaigns/2710262/leads`, "0"],
      [`${API}/campaigns/2710262/leads`, "2"],
      [`${API}/campaigns/2710100/leads`, "0"],
    ],
    "the campaign list and the category names are read once and carried in the cursor"
  );
  assert.deepEqual(
    leads.map((lead) => [lead.sourceId, lead.campaignRef, lead.status]),
    [
      ["2995276770", "smartlead:client-a:2710262", "active"],
      ["2995276771", "smartlead:client-a:2710262", "completed"],
      ["2995276772", "smartlead:client-a:2710262", "active"],
      ["4", "smartlead:client-a:2710100", "paused"],
    ]
  );

  const empty = harness(suite, () => Response.json([]));
  const none = await empty.settle(empty.outbound.leads.list());
  assert.deepEqual(none.items, []);
  assert.equal(none.complete, true);
  assert.equal(empty.requests.length, 1, "no campaign, no lead request");
});

test("smartlead: leads have no usable date filter, so the wrapper filters and says so", async () => {
  const { outbound, requests, settle } = harness(suite);

  const page = await settle(
    outbound.campaign(CAMPAIGN).leads.list({ since: "2030-01-01" })
  );

  assert.deepEqual(page.items, []);
  assert.equal(page.meta.evidence, "derived");
  assert.equal(urlOf(requests[1]).searchParams.get("created_at_gt"), null);
});

test("smartlead: one lead is read by id, and an empty answer is not found", async () => {
  const { outbound, requests, settle } = harness(suite);
  const lead = await settle(outbound.leads.get(LEAD));
  assert.equal(pathOf(requests[0] as RecordedRequest), `${API}/leads/789`);
  assert.equal(lead.sourceId, "789");
  assert.equal(lead.email, "person1@example.com");
  assert.equal(lead.company, "Example Co");
  assert.equal(lead.progress, "active", "INPROGRESS");
  assert.equal(lead.replied, true, "email_stats.is_replied");
  assert.equal(lead.status, "replied", "a reply is the headline");
  assert.equal(lead.campaignRef, null);
  assert.deepEqual(lead.custom, { job_title: "CEO" });
  assert.equal(lead.interest, "Interested", "category_name");
  assert.equal(
    lead.interestCategory,
    "positive",
    "category 1 has a positive sentiment in the category list"
  );
  assert.deepEqual(lead.tags, ["VIP", "Enterprise"]);
  assert.equal(lead.engagement, null);
  const tags = urlOf(requests[1]);
  assert.equal(tags.pathname, `${API}/crm/leads/tags`);
  assert.equal(tags.searchParams.get("leadId"), "789");
  assert.equal(
    urlOf(requests[2]).pathname,
    `${API}/leads/fetch-categories`,
    "read because the lead has a category"
  );
  assert.equal(requests.length, 3);

  const { category_id: _category, ...uncategorized } = fixture(
    "smartlead",
    "getLeadById.json"
  ) as Record<string, unknown>;

  const plain = harness(suite, (request) =>
    pathOf(request) === `${API}/leads/789`
      ? Response.json(uncategorized)
      : undefined
  );

  const without = await plain.settle(plain.outbound.leads.get(LEAD));
  assert.equal(without.interestCategory, null);
  assert.equal(
    plain.requests.length,
    2,
    "a lead with no category does not cost the category list"
  );

  const missing = harness(suite, () => Response.json({}));
  assert.equal(
    await missing.settle(missing.outbound.leads.exists(LEAD)),
    false
  );
});
