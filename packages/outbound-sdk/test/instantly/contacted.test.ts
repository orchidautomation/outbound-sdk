// `contacted` is unique leads whose sequence started (OUT-86). The numbers
// below are one live campaign from the issue: Instantly's UI showed
// 430 sequences started, `contacted_count` said 1,404 and 1,501 emails went
// out, with one human reply.

import assert from "node:assert/strict";
import { test } from "node:test";

import { computeRates } from "../../src/index.ts";
import type { MetricRow } from "../../src/index.ts";
import { harness } from "../helpers/adapter-suite.ts";
import { fixture } from "../helpers/fixtures.ts";
import { CAMPAIGN, suite } from "./suite.ts";

const LIVE = {
  completed_count: 343,
  contacted_count: 1404,
  emails_sent_count: 1501,
  leads_count: 383,
  new_leads_contacted_count: 430,
  reply_count: 2,
  reply_count_automatic: 11,
  reply_count_unique: 1,
  total_interested: 1,
  total_opportunities: 1,
  total_opportunity_value: 500,
};

const only = (rows: readonly MetricRow[]): MetricRow => {
  const [row] = rows;
  assert.ok(row, "a row");

  return row;
};

test("instantly: contacted is the leads started, so a reply rate is 1 of 430", async () => {
  const { outbound, settle } = harness(suite, () => Response.json(LIVE));
  const row = only((await settle(outbound.campaign(CAMPAIGN).stats())).rows);

  assert.equal(row.contacted, 430, "new_leads_contacted_count");
  assert.notEqual(row.contacted, 1404, "contacted_count counts lead-steps");
  assert.equal(row.sent, 1501);

  const rates = computeRates(row);
  assert.deepEqual(rates.replyRate, { basis: "contacted", value: 1 / 430 });
  assert.deepEqual(rates.positiveReplyRate, {
    basis: "contacted",
    value: 1 / 430,
  });
  assert.notEqual(rates.replyRate.value, 1 / 1404);
});

test("instantly: workspace totals read the same field", async () => {
  const { outbound, settle } = harness(suite, () => Response.json(LIVE));
  const [row] = (await settle(outbound.stats())).rows;

  assert.equal(row?.scope, "workspace");
  assert.equal(row?.contacted, 430);
});

test("instantly: every campaign's row reads new_leads_contacted_count", async () => {
  const { outbound, settle } = harness(suite, () =>
    Response.json([{ ...LIVE, campaign_id: CAMPAIGN }])
  );

  const [row] = (await settle(outbound.stats({ scope: "campaign" }))).rows;

  assert.equal(row?.contacted, 430);
});

test("instantly: without new_leads_contacted_count, contacted is unknown and rates fall back to sent", async () => {
  const { new_leads_contacted_count: _dropped, ...rest } = LIVE;
  const { outbound, settle } = harness(suite, () => Response.json(rest));
  const row = only((await settle(outbound.campaign(CAMPAIGN).stats())).rows);

  assert.equal(row.contacted, null, "contacted_count is not a stand-in");
  assert.deepEqual(computeRates(row).replyRate, {
    basis: "sent",
    value: 1 / 1501,
  });
});

test("instantly: a day counts its new leads, not everyone emailed that day", async () => {
  // Seen live: daily `contacted` equalled `sent` on every day.
  const day = {
    contacted: 94,
    date: "2026-11-10",
    new_leads_contacted: 27,
    sent: 94,
    unique_replies: 1,
  };

  const { outbound, settle } = harness(suite, () => Response.json([day]));

  const row = only(
    (await settle(outbound.campaign(CAMPAIGN).stats({ by: "day" }))).rows
  );

  assert.equal(row.contacted, 27);

  assert.deepEqual(computeRates(row).replyRate, {
    basis: "contacted",
    value: 1 / 27,
  });
});

test("instantly: a mailbox total adds each day's new leads", async () => {
  const { outbound, settle } = harness(suite);

  const [total] = (await settle(outbound.sender("person1@example.com").stats()))
    .rows;

  const days = fixture("instantly", "getAccountDailyAnalytics.json") as {
    contacted: number;
    new_leads_contacted: number;
  }[];

  assert.equal(
    total?.contacted,
    days.reduce((sum, day) => sum + day.new_leads_contacted, 0)
  );
  assert.notEqual(
    total?.contacted,
    days.reduce((sum, day) => sum + day.contacted, 0)
  );
});

test("instantly: a step's contacted is the leads that step reached, when reported", async () => {
  const steps = [
    { contacted: 430, sent: 430, step: "0", variant: "0" },
    { sent: 400, step: "1", variant: "0" },
  ];

  const { outbound, settle } = harness(suite, () => Response.json(steps));

  const { rows } = await settle(
    outbound.campaign(CAMPAIGN).stats({ scope: "step" })
  );

  assert.deepEqual(
    rows.map((row) => [row.stepIndex, row.contacted]),
    [
      [0, 430],
      [1, null],
    ]
  );
});
