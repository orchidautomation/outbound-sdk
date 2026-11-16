// Leads at one domain, found with the `search` field of POST /leads/list
// instead of by walking every lead (OUT-98).

import assert from "node:assert/strict";
import { test } from "node:test";

import { createOutbound, MemoryRateLimitStore } from "../../src/index.ts";
import { insights } from "../../src/insights/index.ts";
import { harness } from "../helpers/adapter-suite.ts";
import { createClock } from "../helpers/clock.ts";
import { fixture } from "../helpers/fixtures.ts";
import { createFetch } from "../helpers/http.ts";
import type { RecordedRequest } from "../helpers/http.ts";
import { suite } from "./suite.ts";

const ID = "01a1d77f-5156-7723-b616-dca4fb9915";

const sent = (request: RecordedRequest | undefined): unknown => [
  request?.method,
  new URL(request?.url ?? "").pathname,
  JSON.parse(request?.body ?? "{}"),
];

const [LEAD = {}] = (
  fixture("instantly", "listLeadsByEmail.json") as {
    items: Record<string, unknown>[];
  }
).items;

const lead = (
  id: string,
  email: string | null,
  extra: Record<string, unknown> = {}
): Record<string, unknown> => ({ ...LEAD, email, id: `${ID}${id}`, ...extra });

// What a search for `acme.example` can match besides the company's own
// addresses: a look-alike domain, a subdomain, a company field and a lead
// with no address.
const SEARCHED = [
  lead("01", "Person1@Acme.example", { lt_interest_status: 1 }),
  lead("02", "person2@notacme.example"),
  lead("03", "person3@mail.acme.example"),
  lead("04", "person4@other.example", { company_name: "acme.example" }),
  lead("05", null),
  lead("06", "person6@acme.example"),
];

test("instantly: leads at a domain are found with search, keeping only that exact domain", async () => {
  const { outbound, requests, settle } = harness(suite, () =>
    Response.json({ items: SEARCHED })
  );

  assert.equal(outbound.capabilities["leads.byDomain"], true);

  const page = await settle(outbound.leads.list({ domain: " ACME.example " }));

  assert.deepEqual(sent(requests[0]), [
    "POST",
    "/api/v2/leads/list",
    { limit: 100, search: "acme.example" },
  ]);
  assert.deepEqual(
    page.items.map((found) => found.email),
    ["person1@acme.example", "person6@acme.example"]
  );
});

test("instantly: a domain search can be kept to one campaign and follows the cursor", async () => {
  const campaign = "01a1d77f-0000-7000-8000-000000000001";

  const { outbound, requests, settle } = harness(suite, (request) =>
    JSON.parse(request.body ?? "{}").starting_after === undefined
      ? Response.json({
          items: [SEARCHED[0]],
          next_starting_after: `${ID}01`,
        })
      : Response.json({ items: [SEARCHED[5]] })
  );

  const leads = await settle(
    outbound
      .campaign(campaign)
      .leads.listAll({ domain: "acme.example" })
      .toArray()
  );

  assert.equal(leads.length, 2);
  assert.deepEqual(
    requests.map((request) => sent(request)),
    [
      [
        "POST",
        "/api/v2/leads/list",
        { campaign, limit: 100, search: "acme.example" },
      ],
      [
        "POST",
        "/api/v2/leads/list",
        {
          campaign,
          limit: 100,
          search: "acme.example",
          starting_after: `${ID}01`,
        },
      ],
    ]
  );
});

test("instantly: text that is not a bare domain is refused before any request", async () => {
  const { outbound, requests, settle } = harness(suite);

  for (const domain of [
    "person1@acme.example",
    "https://acme.example",
    "acme",
  ]) {
    // oxlint-disable-next-line no-await-in-loop -- each refusal is checked on its own.
    await assert.rejects(
      async () => await settle(outbound.leads.list({ domain })),
      (error) =>
        error instanceof Error && /is not a domain such as/u.test(error.message)
    );
  }

  assert.equal(requests.length, 0);
});

test("instantly: account_summary finds the company in one request, wherever its leads are", async () => {
  const clock = createClock();
  const http = createFetch(() => Response.json({ items: SEARCHED }));

  const outbound = createOutbound({
    adapter: suite.make(),
    fetch: http.fetch,
    plugins: [insights()],
    rateLimitStore: new MemoryRateLimitStore(),
    runtime: clock.runtime,
    share: 1,
  });

  const result = await clock.settle(
    outbound.insights.accountSummary({
      domain: "https://www.acme.example/about",
    })
  );

  assert.equal(result.data.domain, "acme.example");
  assert.equal(result.data.foundBy, "search");
  assert.deepEqual(
    result.data.people.map((person) => person.email),
    ["person1@acme.example", "person6@acme.example"]
  );
  assert.equal(result.data.people[0]?.records[0]?.interest, "Interested");
  assert.equal(result.data.totals.moreLeadsExist, false);
  assert.equal(http.requests.length, 1);
  assert.deepEqual(sent(http.requests[0]), [
    "POST",
    "/api/v2/leads/list",
    { limit: 100, search: "acme.example" },
  ]);
});
