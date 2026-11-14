import assert from "node:assert/strict";
import { test } from "node:test";

import { harness } from "../helpers/adapter-suite.ts";
import { fixture } from "../helpers/fixtures.ts";
import type { RecordedRequest } from "../helpers/http.ts";
import { API, EMAIL, suite, urlOf } from "./suite.ts";

const pathOf = (request: RecordedRequest): string => urlOf(request).pathname;

const paths = (requests: readonly RecordedRequest[]): string[] =>
  requests.map((request) => pathOf(request));

const BY_EMAIL = `${API}/leads/`;

test("smartlead: a lead is found by address in one read, one record per campaign", async () => {
  const { outbound, requests, settle } = harness(suite);
  assert.equal(outbound.capabilities["leads.lookup"], true);

  const page = await settle(
    outbound.leads.list({ email: " Person1@Example.com " })
  );

  assert.deepEqual(
    paths(requests),
    [BY_EMAIL, `${API}/leads/fetch-categories`],
    "the lead with its campaigns, then the category names; no campaign is walked"
  );
  assert.equal(
    urlOf(requests[0]).searchParams.get("email"),
    EMAIL,
    "the address is sent trimmed and lowercased"
  );
  assert.deepEqual(
    page.items.map((lead) => [
      lead.sourceId,
      lead.campaignRef,
      lead.email,
      lead.status,
      lead.interest,
    ]),
    [
      [
        "2995276770",
        "smartlead:client-a:2710262",
        EMAIL,
        "unknown",
        "Interested",
      ],
      ["2995276770", "smartlead:client-a:2710100", EMAIL, "unknown", null],
    ],
    "lead_campaign_data gives the campaign and the category, not the status"
  );
  assert.equal(page.complete, true);

  const [lead] = page.items;
  assert.equal(lead?.ref, "smartlead:client-a:2995276770");
  assert.equal(lead?.firstName, "Alex");
  assert.equal(lead?.company, "Example Co");
  assert.equal(
    lead?.linkedinUrl,
    "https://www.linkedin.com/in/example-person-1"
  );
  assert.equal(lead?.createdAt, "2025-11-25T12:54:54.000Z");
  assert.deepEqual(lead?.tags, []);

  const raw = lead?.raw as
    | { campaign_lead_map_id: number; lead: Record<string, unknown> }
    | undefined;

  assert.equal(raw?.campaign_lead_map_id, 2_433_664_091);
  assert.equal(raw?.lead.email, EMAIL);
  assert.equal(
    "lead_campaign_data" in (raw?.lead ?? {}),
    false,
    "raw holds this campaign's item only"
  );
});

test("smartlead: with a campaign, a lookup returns that campaign's record only", async () => {
  const { outbound, requests, settle } = harness(suite);

  const page = await settle(
    outbound.campaign("2710100").leads.list({ email: EMAIL })
  );

  assert.deepEqual(
    page.items.map((lead) => lead.campaignRef),
    ["smartlead:client-a:2710100"]
  );
  assert.deepEqual(
    paths(requests),
    [BY_EMAIL],
    "that campaign gives no category, so the category names are not read"
  );

  const other = harness(suite);

  const none = await other.settle(
    other.outbound.campaign("372").leads.list({ email: EMAIL })
  );

  assert.deepEqual(none.items, [], "the lead is not in campaign 372");
  assert.equal(none.complete, true);
  assert.deepEqual(paths(other.requests), [BY_EMAIL]);
});

test("smartlead: an address with no lead gives an empty page, not an error", async () => {
  const { outbound, requests, settle } = harness(suite);

  const page = await settle(
    outbound.leads.list({ email: "nobody@example.com" })
  );

  assert.deepEqual(page.items, [], "the documented answer is {} with 200");
  assert.equal(page.complete, true);
  assert.deepEqual(paths(requests), [BY_EMAIL]);

  // How Smartlead matches the address is not documented.
  const loose = harness(suite);

  const near = await loose.settle(
    loose.outbound.leads.list({ email: "person@example.com" })
  );

  const partial = harness(suite, (request) =>
    pathOf(request) === BY_EMAIL
      ? Response.json(fixture("smartlead", "getLeadByEmail.json"))
      : undefined
  );

  const wrong = await partial.settle(
    partial.outbound.leads.list({ email: "person@example.com" })
  );

  assert.deepEqual(near.items, []);
  assert.deepEqual(wrong.items, [], "a lead with another address is dropped");
  assert.deepEqual(paths(partial.requests), [BY_EMAIL]);
});

test("smartlead: a lookup accepts the wrapped envelope and a lead without lead_campaign_data", async () => {
  const { lead_campaign_data: _campaigns, ...bare } = fixture(
    "smartlead",
    "getLeadByEmail.json"
  ) as Record<string, unknown>;

  const { outbound, requests, settle } = harness(suite, (request) =>
    pathOf(request) === BY_EMAIL
      ? Response.json({ data: { ...bare, is_unsubscribed: true }, ok: true })
      : undefined
  );

  const page = await settle(outbound.leads.list({ email: EMAIL }));

  assert.deepEqual(
    paths(requests),
    [BY_EMAIL, `${API}/leads/2995276770/campaigns`],
    "without the campaign list, the lead's campaigns are read"
  );
  assert.deepEqual(
    page.items.map((lead) => [lead.campaignRef, lead.status, lead.interest]),
    [
      ["smartlead:client-a:2911", "unsubscribed", null],
      ["smartlead:client-a:5055", "unsubscribed", null],
    ],
    "that list's status is the campaign's, so it is not the lead's"
  );
});

test("smartlead: a LinkedIn profile finds no lead and sends no request", async () => {
  const { outbound, requests, settle } = harness(suite);

  const page = await settle(
    outbound.leads.list({
      linkedinUrl: "https://www.linkedin.com/in/example-person-1",
    })
  );

  assert.deepEqual(page.items, []);
  assert.equal(page.complete, true);

  const both = await settle(
    outbound.leads.list({
      email: EMAIL,
      linkedinUrl: "https://www.linkedin.com/in/example-person-1",
    })
  );

  assert.deepEqual(both.items, []);
  assert.equal(requests.length, 0);
});
