import assert from "node:assert/strict";
import { test } from "node:test";

import { harness } from "../helpers/adapter-suite.ts";
import { fixture } from "../helpers/fixtures.ts";
import type { RecordedRequest } from "../helpers/http.ts";
import { CAMPAIGN, suite } from "./suite.ts";

const EMAIL = "person7@example.com";
const FIRST = "01a1d77f-5156-7723-b616-dca4fb991501";
const SECOND = "01a1d77f-5156-7723-b616-dca4fb991502";
const THIRD = "01a1d77f-5156-7723-b616-dca4fb991503";

const sent = (request: RecordedRequest | undefined): unknown => [
  request?.method,
  new URL(request?.url ?? "").pathname,
  JSON.parse(request?.body ?? "{}"),
];

const items = (file: string): Record<string, unknown>[] =>
  (fixture("instantly", file) as { items: Record<string, unknown>[] }).items;

test("instantly: a lead is found by email with the contacts filter, one record per campaign", async () => {
  const { outbound, requests, settle } = harness(suite);

  const page = await settle(
    outbound.leads.list({ email: " PERSON7@example.com " })
  );

  assert.equal(requests.length, 1, "no custom status, so no label lookup");
  assert.deepEqual(sent(requests[0]), [
    "POST",
    "/api/v2/leads/list",
    { contacts: [EMAIL], limit: 100 },
  ]);
  assert.deepEqual(
    page.items.map((lead) => [lead.sourceId, lead.email]),
    [
      [FIRST, EMAIL],
      [SECOND, EMAIL],
    ],
    "an address Instantly spells with capitals is the same address"
  );
  assert.notEqual(page.items[0]?.campaignRef, page.items[1]?.campaignRef);
  assert.equal(page.items[0]?.campaignRef, `instantly:client-a:${CAMPAIGN}`);
});

test("instantly: a lookup by email follows the cursor to the last page", async () => {
  const { outbound, requests, settle } = harness(suite);

  const leads = await settle(
    outbound.leads.listAll({ email: EMAIL }).toArray()
  );

  assert.deepEqual(
    leads.map((lead) => lead.sourceId),
    [FIRST, SECOND, THIRD]
  );
  assert.deepEqual(
    requests.map((request) => sent(request)),
    [
      ["POST", "/api/v2/leads/list", { contacts: [EMAIL], limit: 100 }],
      [
        "POST",
        "/api/v2/leads/list",
        { contacts: [EMAIL], limit: 100, starting_after: SECOND },
      ],
    ]
  );
});

test("instantly: only records with exactly the address asked for are returned", async () => {
  const [lead] = items("listLeadsByEmail.json");

  const { outbound, requests, settle } = harness(suite, () =>
    Response.json({
      items: [
        { ...lead, email: "person77@example.com", id: `${FIRST}-a` },
        lead,
        { ...lead, email: "person7@example.org", id: `${FIRST}-b` },
        { ...lead, email: null, id: `${FIRST}-c` },
      ],
      next_starting_after: `${FIRST}-c`,
    })
  );

  const page = await settle(outbound.leads.list({ email: EMAIL }));

  assert.deepEqual(
    page.items.map((found) => found.sourceId),
    [FIRST]
  );
  assert.equal(page.complete, false, "Instantly said there is another page");
  assert.equal(requests.length, 1);

  await settle(outbound.leads.list({ cursor: page.cursor, email: EMAIL }));
  assert.deepEqual(
    sent(requests[1]),
    [
      "POST",
      "/api/v2/leads/list",
      { contacts: [EMAIL], limit: 100, starting_after: `${FIRST}-c` },
    ],
    "the next page starts after the last record Instantly sent, kept or not"
  );
});

test("instantly: a lookup by email can be kept to one campaign", async () => {
  const { outbound, requests, settle } = harness(suite);

  const page = await settle(
    outbound.campaign(CAMPAIGN).leads.list({ email: EMAIL, limit: 10 })
  );

  assert.deepEqual(sent(requests[0]), [
    "POST",
    "/api/v2/leads/list",
    { campaign: CAMPAIGN, contacts: [EMAIL], limit: 10 },
  ]);
  assert.equal(page.items.length, 2);
});

test("instantly: an address nobody has gives an empty page", async () => {
  const { outbound, requests, settle } = harness(suite, () =>
    Response.json({ items: [] })
  );

  const page = await settle(
    outbound.leads.list({ email: "nobody@example.com" })
  );

  assert.deepEqual(page.items, []);
  assert.equal(page.cursor, undefined);
  assert.equal(page.complete, true);
  assert.deepEqual(sent(requests[0]), [
    "POST",
    "/api/v2/leads/list",
    { contacts: ["nobody@example.com"], limit: 100 },
  ]);
});

test("instantly: a lookup by LinkedIn profile is empty and sends nothing", async () => {
  const { outbound, requests, settle } = harness(suite);
  const profile = "https://www.linkedin.com/in/example-person-1";

  assert.equal(outbound.capabilities["leads.lookup"], true);
  assert.deepEqual(
    (await settle(outbound.leads.list({ linkedinUrl: profile }))).items,
    []
  );
  assert.deepEqual(
    (await settle(outbound.leads.list({ email: EMAIL, linkedinUrl: profile })))
      .items,
    [],
    "a lead must match both, and none has a profile"
  );
  assert.equal(requests.length, 0);
});
