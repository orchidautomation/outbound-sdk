// lead_runway and pipeline_forecast share one runway (OUT-94): new leads
// started per day, never emails sent, over the complete days ending
// yesterday, dividing only the active leads not yet started.

import assert from "node:assert/strict";
import { test } from "node:test";

import { createOutbound } from "../src/index.ts";
import { insights } from "../src/insights/index.ts";
import { instantly } from "../src/instantly/index.ts";
import { memory } from "../src/memory/index.ts";
import type { MemoryData, MemoryLead } from "../src/memory/index.ts";
import { createTools } from "../src/tools/index.ts";
import type { ToolResult } from "../src/tools/index.ts";
import { createFetch } from "./helpers/http.ts";
import { CAMPAIGN, KEY } from "./instantly/suite.ts";

const DAY_MS = 86_400_000;

const daysAgo = (days: number): string =>
  new Date(Date.now() - days * DAY_MS).toISOString().slice(0, 10);

const STARTED = {
  lastContactedAt: `${daysAgo(2)}T09:00:00.000Z`,
  stepIndex: 1,
};

const active = (
  campaignId: string,
  id: string,
  started: boolean
): MemoryLead => {
  const lead: MemoryLead = { campaignId, id, status: "active" };

  return started ? { ...lead, engagement: STARTED } : lead;
};

const many = (
  count: number,
  campaignId: string,
  prefix: string,
  started: boolean
): MemoryLead[] =>
  Array.from({ length: count }, (_, index) =>
    active(campaignId, `${prefix}${index}`, started)
  );

const DATA: MemoryData = {
  campaigns: [
    { id: "c1", name: "Split" },
    { id: "c2", name: "Sends only" },
    { id: "c3", name: "No progress reported" },
    { id: "c4", name: "All in sequence" },
  ],
  leads: [
    ...many(12, "c1", "s", true),
    ...many(18, "c1", "n", false),
    { campaignId: "c1", id: "done", status: "completed" },
    ...many(6, "c2", "c2-", false),
    ...many(5, "c3", "c3-", false),
    ...many(3, "c4", "c4-", true),
  ],
  stats: [
    // 4 + 10 leads started over the 7 complete days: 2 a day. The emails
    // sent (mostly follow-ups) would give a pace of 100 / 7.
    { campaignId: "c1", counts: { contacted: 4, sent: 40 }, date: daysAgo(1) },
    { campaignId: "c1", counts: { contacted: 10, sent: 60 }, date: daysAgo(3) },
    // Today is not over, and 10 days ago is outside the window.
    { campaignId: "c1", counts: { contacted: 50, sent: 50 }, date: daysAgo(0) },
    { campaignId: "c1", counts: { contacted: 100 }, date: daysAgo(10) },
    // Emails sent with no count of leads started.
    { campaignId: "c2", counts: { sent: 70 }, date: daysAgo(2) },
    { campaignId: "c3", counts: { contacted: 7, sent: 9 }, date: daysAgo(1) },
    { campaignId: "c4", counts: { contacted: 7, sent: 21 }, date: daysAgo(1) },
  ],
};

const memoryOutbound = () =>
  createOutbound({
    adapter: memory({ data: DATA, workspaceId: "acme" }),
    plugins: [insights()],
  });

type Insighted = ReturnType<typeof memoryOutbound>;

const runway = async (
  outbound: Insighted,
  campaign: string
): Promise<Record<string, unknown>> => {
  const tool = createTools(outbound).find(
    (candidate) => candidate.name === "lead_runway"
  );

  assert.ok(tool, "lead_runway is offered");

  const result: ToolResult = await tool.call({
    campaign,
    lookback_days: 7,
  } as never);

  assert.equal(result.ok, true, JSON.stringify(result));

  return (result as { data: Record<string, unknown> }).data;
};

const both = async (outbound: Insighted, campaign: string) => {
  const tool = await runway(outbound, campaign);

  const { data } = await outbound.insights.pipelineForecast({
    campaign,
    days: 7,
  });

  // The two tools agree on every figure they share.
  assert.equal(tool.runway_days, data.daysLeft, "same runway");
  assert.equal(tool.contacted_per_day, data.dailyContactRate, "same pace");
  assert.equal(tool.not_started, data.notStarted);
  assert.equal(tool.in_sequence, data.inSequence);
  assert.equal(tool.active_leads, data.remaining);

  return { forecast: data, tool };
};

test("runway: both tools divide the leads not started by new leads started per day", async () => {
  const { forecast, tool } = await both(memoryOutbound(), "memory:acme:c1");

  assert.deepEqual(tool, {
    active_leads: 30,
    campaign: "memory:acme:c1",
    contacted_per_day: 2,
    counted_leads: 31,
    in_sequence: 12,
    not_started: 18,
    // 18 not started at 2 a day; the 12 in sequence need no new contact.
    runway_days: 9,
  });
  assert.equal(
    forecast.remaining,
    30,
    "replies still project over every active lead"
  );
  assert.match(forecast.finding, /^30 leads remain/u);
});

test("runway: emails sent are not a pace, so a campaign with no leads-started count has no runway", async () => {
  const { tool } = await both(memoryOutbound(), "memory:acme:c2");

  assert.equal(
    tool.contacted_per_day,
    null,
    "70 emails are not 10 leads a day"
  );
  assert.equal(tool.runway_days, null);
});

test("runway: with no lead's progress reported, every active lead counts as not started", async () => {
  const { tool } = await both(memoryOutbound(), "memory:acme:c3");

  assert.equal(tool.not_started, null);
  assert.equal(tool.in_sequence, null);
  assert.equal(tool.contacted_per_day, 1);
  assert.equal(tool.runway_days, 5, "all 5 active leads at 1 a day");
});

test("runway: leads still finishing the sequence leave no runway of new leads", async () => {
  const { forecast, tool } = await both(memoryOutbound(), "memory:acme:c4");

  assert.equal(tool.not_started, 0);
  assert.equal(tool.in_sequence, 3);
  assert.equal(tool.runway_days, 0);
  assert.equal(
    forecast.finding,
    "No new leads are left to start; 3 leads are finishing the sequence. Add leads to keep the campaign starting new ones."
  );
});

// The live campaign from the issue: Instantly's daily `contacted` equalled
// `sent` on every day, while far fewer leads were started.
const LIVE_TOTALS = {
  contacted_count: 1404,
  emails_sent_count: 1501,
  new_leads_contacted_count: 430,
  reply_count_unique: 1,
  total_interested: 1,
};

const LIVE_DAYS = [
  { contacted: 250, date: daysAgo(6), new_leads_contacted: 8, sent: 250 },
  { contacted: 119, date: daysAgo(4), new_leads_contacted: 3, sent: 119 },
  { contacted: 56, date: daysAgo(1), new_leads_contacted: 3, sent: 56 },
];

const instantlyLead = (id: string, started: boolean) => {
  const lead = {
    campaign: CAMPAIGN,
    email: `${id}@example.com`,
    email_open_count: 0,
    email_reply_count: 0,
    id,
    status: 1,
  };

  return started
    ? { ...lead, timestamp_last_contact: `${daysAgo(2)}T09:00:00.000Z` }
    : lead;
};

const LIVE_LEADS = [
  ...Array.from({ length: 6 }, (_, index) =>
    instantlyLead(`started-${index}`, true)
  ),
  ...Array.from({ length: 4 }, (_, index) =>
    instantlyLead(`waiting-${index}`, false)
  ),
];

const instantlyOutbound = (): Insighted => {
  const http = createFetch((request) => {
    const { pathname } = new URL(request.url);

    if (pathname === "/api/v2/campaigns/analytics/daily") {
      return Response.json(LIVE_DAYS);
    }

    if (pathname === "/api/v2/campaigns/analytics/overview") {
      return Response.json(LIVE_TOTALS);
    }

    if (pathname === "/api/v2/leads/list") {
      return Response.json({ items: LIVE_LEADS });
    }

    if (pathname === `/api/v2/campaigns/${CAMPAIGN}`) {
      return Response.json({ id: CAMPAIGN, name: "Live", status: 1 });
    }

    return Response.json({ items: [] });
  });

  return createOutbound({
    adapter: instantly({ apiKey: KEY, workspaceId: "client-a" }),
    fetch: http.fetch,
    plugins: [insights()],
  });
};

test("runway: on Instantly the pace is new_leads_contacted, not the daily contacted that equals sent", async () => {
  const { forecast, tool } = await both(
    instantlyOutbound(),
    `instantly:client-a:${CAMPAIGN}`
  );

  // 8 + 3 + 3 leads started over 7 days, not 425 emails.
  assert.equal(tool.contacted_per_day, 2);
  assert.equal(tool.not_started, 4);
  assert.equal(tool.in_sequence, 6);
  assert.equal(tool.runway_days, 2);

  // Rates divide by the 430 leads started, not 1,404 lead-step contacts.
  assert.equal(forecast.replyRate.of, 430);
  assert.equal(forecast.replyRate.count, 1);
});
