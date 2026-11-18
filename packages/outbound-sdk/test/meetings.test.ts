// OUT-162: a meetings count where the vendor records one, and null with a
// reason where it does not, never opportunities or positive replies.

import assert from "node:assert/strict";
import { test } from "node:test";

import { emailbison } from "../src/emailbison/index.ts";
import { heyreach } from "../src/heyreach/index.ts";
import { createOutbound } from "../src/index.ts";
import { instantly } from "../src/instantly/index.ts";
import type { MemoryData } from "../src/memory/index.ts";
import { smartlead } from "../src/smartlead/index.ts";
import { harness } from "./helpers/adapter-suite.ts";
import { suite as heyreachSuite } from "./heyreach/suite.ts";
import { NOW, single } from "./insights/helpers.ts";
import { row } from "./insights/ops-helpers.ts";
import { CAMPAIGN, suite as instantlySuite } from "./instantly/suite.ts";

// The SDR manager's week, read live on 2026-11-18 from GET
// /campaigns/analytics/overview (other counts trimmed): no meeting booked,
// though opportunities and interested leads were 2 each.
const LIVE_WEEK = {
  emails_sent_count: 8417,
  new_leads_contacted_count: 1173,
  reply_count_unique: 17,
  total_closed: 0,
  total_interested: 2,
  total_meeting_booked: 0,
  total_meeting_completed: 0,
  total_opportunities: 2,
};

test("instantly: meetingsBooked is total_meeting_booked from the overview, 0 kept as 0", async () => {
  const { outbound, settle } = harness(instantlySuite, (request) =>
    new URL(request.url).pathname === "/api/v2/campaigns/analytics/overview"
      ? Response.json(LIVE_WEEK)
      : undefined
  );

  const [week] = (
    await settle(outbound.stats({ from: "2026-11-10", to: "2026-11-16" }))
  ).rows;

  assert.equal(week?.meetingsBooked, 0, "no meeting booked is 0, not null");
  assert.equal(week?.opportunities, 2, "opportunities stay apart");
  assert.equal(week?.positive, 2);
  assert.equal(outbound.fields.metricRow.meetingsBooked, "exact");
});

test("instantly: one campaign's total carries meetings; rows of reports without them are null", async () => {
  const { outbound, settle } = harness(instantlySuite);

  const [total] = (await settle(outbound.campaign(CAMPAIGN).stats())).rows;
  assert.equal(total?.meetingsBooked, 45, "the fixture's total_meeting_booked");

  const every = await settle(outbound.stats({ scope: "campaign" }));
  assert.ok(every.rows.length > 0);
  assert.ok(
    every.rows.every((each) => each.meetingsBooked === null),
    "GET /campaigns/analytics reports no meetings"
  );

  const daily = await settle(outbound.stats({ by: "day" }));
  assert.ok(daily.rows.every((each) => each.meetingsBooked === null));
});

test("heyreach, smartlead and emailbison record no meetings: null, and fields say so", async () => {
  const { outbound, settle } = harness(heyreachSuite);
  const [total] = (await settle(outbound.stats())).rows;

  assert.equal(total?.meetingsBooked, null);
  assert.ok(total?.positive !== undefined);

  for (const adapter of [
    heyreach({ apiKey: "test-key" }),
    smartlead({ apiKey: "test-key" }),
    emailbison({ apiKey: "test-key" }),
  ]) {
    const each = createOutbound({ adapter });
    assert.equal(each.fields.metricRow.meetingsBooked, false, adapter.name);
  }

  assert.equal(
    createOutbound({ adapter: instantly({ apiKey: "test-key" }) }).fields
      .metricRow.meetingsBooked,
    "exact"
  );
});

// NOW is 2026-11-14: the period is 11-07 to 11-13, the one before 10-31 to 11-06.
const DATA: MemoryData = {
  campaigns: [
    { id: "c1", name: "Booked" },
    { id: "c2", name: "Unknown" },
  ],
  stats: [
    row("c1", "2026-11-01", {
      meetingsBooked: 3,
      opportunities: 9,
      positive: 9,
      replied: 20,
      sent: 400,
    }),
    row("c1", "2026-11-08", {
      meetingsBooked: 1,
      opportunities: 2,
      positive: 2,
      replied: 17,
      sent: 400,
    }),
    row("c2", "2026-11-02", {
      opportunities: 4,
      positive: 4,
      replied: 10,
      sent: 300,
    }),
    row("c2", "2026-11-09", {
      opportunities: 4,
      positive: 4,
      replied: 10,
      sent: 300,
    }),
  ],
};

test("period_comparison and client_report show meetings booked, apart from opportunities", async () => {
  const comparison = await single(DATA).insights.periodComparison(
    {},
    { now: NOW }
  );

  const booked = comparison.data.campaigns.find(
    (each) => each.campaignName === "Booked"
  );

  assert.equal(booked?.current.meetingsBooked, 1);
  assert.equal(booked?.previous.meetingsBooked, 3);
  assert.equal(booked?.change.meetingsBooked, -2);
  assert.equal(comparison.data.total.current.meetingsBooked, 1);
  assert.ok(
    comparison.meta.notes.includes(
      "meetingsBooked counts only the 1 of 2 campaigns that report meetings booked; the others are left out, not counted as 0."
    ),
    comparison.meta.notes.join(" | ")
  );

  const report = await single(DATA).insights.clientReport({}, { now: NOW });
  assert.equal(report.data.totals.current.meetingsBooked, 1);
  assert.equal(report.data.totals.previous.meetingsBooked, 3);
});

test("period_comparison says why meetings are null, and never substitutes opportunities", async () => {
  const none: MemoryData = {
    campaigns: [{ id: "c2", name: "Unknown" }],
    stats: (DATA.stats ?? []).filter((each) => each.campaignId === "c2"),
  };

  const result = await single(none).insights.periodComparison(
    { min_sent: 0 },
    { now: NOW }
  );

  assert.equal(result.data.total.current.meetingsBooked, null);
  assert.equal(result.data.total.current.positive, 4);
  assert.ok(
    result.meta.notes.some((note) =>
      note.startsWith("meetingsBooked is null: no campaign read reports")
    ),
    result.meta.notes.join(" | ")
  );
});

test("period_comparison sets the meetings change to null when the periods count different campaigns", async () => {
  const shifted: MemoryData = {
    campaigns: [
      { id: "c1", name: "Earlier" },
      { id: "c2", name: "Later" },
    ],
    stats: [
      row("c1", "2026-11-01", { meetingsBooked: 3, replied: 20, sent: 400 }),
      row("c1", "2026-11-08", { replied: 17, sent: 400 }),
      row("c2", "2026-11-02", { replied: 10, sent: 300 }),
      row("c2", "2026-11-09", { meetingsBooked: 2, replied: 10, sent: 300 }),
    ],
  };

  const result = await single(shifted).insights.periodComparison(
    {},
    { now: NOW }
  );

  assert.equal(result.data.total.previous.meetingsBooked, 3);
  assert.equal(result.data.total.current.meetingsBooked, 2);
  assert.equal(result.data.total.change.meetingsBooked, null);
  assert.ok(
    result.meta.notes.includes(
      "meetingsBooked counts different campaigns in the two periods: 1 of 2 this period and 1 of 2 the period before, so change.meetingsBooked is null rather than a difference between unlike totals. Campaigns that do not report meetings are left out, not counted as 0."
    ),
    result.meta.notes.join(" | ")
  );
});
