// The active leads of a campaign, listed with the `filter` FILTER_VAL_ACTIVE
// of POST /leads/list instead of by walking every lead (OUT-131).

import assert from "node:assert/strict";
import { test } from "node:test";

import { createOutbound } from "../../src/index.ts";
import { memory } from "../../src/memory/index.ts";
import { harness } from "../helpers/adapter-suite.ts";
import { fixture } from "../helpers/fixtures.ts";
import type { RecordedRequest } from "../helpers/http.ts";
import { suite } from "./suite.ts";

const ID = "01a1d77f-5156-7723-b616-dca4fb9915";
const CAMPAIGN = "01a1d77f-0000-7000-8000-000000000001";

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
  extra: Record<string, unknown>
): Record<string, unknown> => ({
  ...LEAD,
  email: `person${id}@example.com`,
  id: `${ID}${id}`,
  ...extra,
});

// What the filter returned, including a lead the adapter does not read as
// active: one that replied while still in the sequence.
const FILTERED = [
  lead("01", { email_reply_count: 0, status: 1 }),
  lead("02", { email_reply_count: 2, status: 1 }),
  lead("03", { email_reply_count: 0, status: 1 }),
];

test("instantly: a campaign's active leads are listed with FILTER_VAL_ACTIVE, keeping only the leads read as active", async () => {
  const { outbound, requests, settle } = harness(suite, (request) =>
    JSON.parse(request.body ?? "{}").starting_after === undefined
      ? Response.json({
          items: FILTERED.slice(0, 2),
          next_starting_after: `${ID}02`,
        })
      : Response.json({ items: FILTERED.slice(2) })
  );

  assert.equal(outbound.capabilities["leads.byStatus"], true);

  const leads = await settle(
    outbound.campaign(CAMPAIGN).leads.listAll({ status: "active" }).toArray()
  );

  assert.deepEqual(
    leads.map((each) => [each.email, each.status]),
    [
      ["person01@example.com", "active"],
      ["person03@example.com", "active"],
    ]
  );
  assert.deepEqual(
    requests.map((request) => sent(request)),
    [
      [
        "POST",
        "/api/v2/leads/list",
        { campaign: CAMPAIGN, filter: "FILTER_VAL_ACTIVE", limit: 100 },
      ],
      [
        "POST",
        "/api/v2/leads/list",
        {
          campaign: CAMPAIGN,
          filter: "FILTER_VAL_ACTIVE",
          limit: 100,
          starting_after: `${ID}02`,
        },
      ],
    ]
  );
});

test("the status filter takes active only, not with interest, and needs leads.byStatus, before any request", async () => {
  const { outbound, requests } = harness(suite, () =>
    Response.json({ items: [] })
  );

  await assert.rejects(
    async () =>
      await outbound.leads.list({
        // SAFETY: a caller outside TypeScript can pass any status.
        status: "replied" as "active",
      }),
    { code: "Invalid", message: 'status takes "active", not "replied"' }
  );
  await assert.rejects(
    async () =>
      await outbound.leads.list({ interest: "positive", status: "active" }),
    {
      code: "Invalid",
      message: "Leads can be listed by interest or by status, not both at once",
    }
  );

  const without = createOutbound({
    adapter: memory({ capabilities: { "leads.byStatus": false }, data: {} }),
  });

  await assert.rejects(
    async () => await without.leads.list({ status: "active" }),
    { code: "Unsupported" }
  );
  assert.equal(requests.length, 0);
});
