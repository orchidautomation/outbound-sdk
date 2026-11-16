// Leads, completed leads and opportunities on Instantly's campaign totals
// (OUT-90). The counts are the ones seen live on a four-step campaign on
// 2026-11-15, recorded in docs/research/instantly.md.

import assert from "node:assert/strict";
import { test } from "node:test";

import { harness } from "../helpers/adapter-suite.ts";
import { CAMPAIGN, suite } from "./suite.ts";

const LIVE = {
  campaign_id: CAMPAIGN,
  campaign_name: "Example campaign",
  completed_count: 343,
  contacted_count: 1404,
  emails_sent_count: 1501,
  leads_count: 383,
  new_leads_contacted_count: 430,
  total_opportunities: 1,
  total_opportunity_value: 500,
};

const countsOf = (row: Record<string, unknown> | undefined) => ({
  completed: row?.completed,
  contacted: row?.contacted,
  leads: row?.leads,
  opportunities: row?.opportunities,
  opportunityValue: row?.opportunityValue,
});

test("instantly: every campaign's row carries its leads, completed leads and opportunities", async () => {
  const { outbound, requests, settle } = harness(suite, () =>
    Response.json([LIVE])
  );

  const [row] = (await settle(outbound.stats({ scope: "campaign" }))).rows;

  assert.equal(
    new URL(requests[0]?.url ?? "").pathname,
    "/api/v2/campaigns/analytics"
  );
  assert.deepEqual(countsOf(row), {
    completed: 343,
    contacted: 430,
    leads: 383,
    opportunities: 1,
    opportunityValue: 500,
  });
});

test("instantly: one campaign's total reads completed leads and opportunities from the overview, which has no lead count", async () => {
  const { leads_count: _leads, ...overview } = LIVE;
  const { outbound, settle } = harness(suite, () => Response.json(overview));

  const [row] = (await settle(outbound.campaign(CAMPAIGN).stats())).rows;

  assert.deepEqual(countsOf(row), {
    completed: 343,
    contacted: 430,
    leads: null,
    opportunities: 1,
    opportunityValue: 500,
  });
});

test("instantly: a total without the fields reports them as null, never 0", async () => {
  const { outbound, settle } = harness(suite, () =>
    Response.json([{ campaign_id: CAMPAIGN, emails_sent_count: 10 }])
  );

  const [row] = (await settle(outbound.stats({ scope: "campaign" }))).rows;

  assert.deepEqual(countsOf(row), {
    completed: null,
    contacted: null,
    leads: null,
    opportunities: null,
    opportunityValue: null,
  });
});

test("instantly: daily rows leave leads, completed leads and opportunities null", async () => {
  const day = { date: "2026-10-05", opportunities: 3, sent: 9 };
  const { outbound, settle } = harness(suite, () => Response.json([day]));

  const [row] = (await settle(outbound.campaign(CAMPAIGN).stats({ by: "day" })))
    .rows;

  assert.deepEqual(countsOf(row), {
    completed: null,
    contacted: null,
    leads: null,
    opportunities: null,
    opportunityValue: null,
  });
});
