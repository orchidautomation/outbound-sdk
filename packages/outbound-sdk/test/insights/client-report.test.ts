import assert from "node:assert/strict";
import { test } from "node:test";

import type { MemoryData, MemoryLead } from "../../src/memory/index.ts";
import { NOW, single } from "./helpers.ts";
import { pair, row, unsupported } from "./ops-helpers.ts";

const leads = (campaignId: string, active: number): MemoryLead[] =>
  Array.from({ length: active }, (_, index) => ({
    campaignId,
    email: `${campaignId}${index}@example.com`,
    id: `${campaignId}-${index}`,
  }));

// NOW is 2026-11-14: the period is 11-07 to 11-13 and the one before is
// 10-31 to 11-06. Each campaign has one row in each.
const DATA: MemoryData = {
  campaigns: [
    { id: "a", name: "Winner" },
    { id: "b", name: "Middling" },
    { id: "c", name: "Bouncy" },
    { id: "d", name: "Small", status: "paused" },
  ],
  leads: [
    ...leads("a", 100),
    ...leads("b", 40),
    ...leads("c", 5),
    {
      campaignId: "c",
      email: "done1@example.com",
      id: "c-r1",
      status: "replied",
    },
    {
      campaignId: "c",
      email: "done2@example.com",
      id: "c-r2",
      status: "replied",
    },
    ...leads("d", 1),
  ],
  stats: [
    row("b", "2026-11-02", { contacted: 140, replied: 14, sent: 300 }),
    row("a", "2026-11-03", { contacted: 70, replied: 12, sent: 400 }),
    row("c", "2026-11-04", {
      bounced: 2,
      contacted: 70,
      replied: 9,
      sent: 200,
    }),
    row("b", "2026-11-09", {
      bounced: 3,
      contacted: 140,
      replied: 14,
      sent: 300,
    }),
    row("d", "2026-11-09", { contacted: 20, replied: 1, sent: 20 }),
    row("a", "2026-11-10", {
      bounced: 4,
      contacted: 70,
      replied: 14,
      sent: 400,
    }),
    row("c", "2026-11-11", {
      bounced: 20,
      contacted: 70,
      replied: 2,
      sent: 200,
    }),
  ],
};

// Small reports no bounces, and in the earlier period only Bouncy does.
const BOUNCE_NOTE =
  "Totals: this period's bounce rate (3 of 4), the earlier period's bounce rate (1 of 3) count only the campaigns that report both the count and what it is divided by. The others are left out of the rate, not counted as 0.";

test("client_report composes totals, best and worst campaigns, bounce problems, unusual days, leads left and actions", async () => {
  const result = await single(DATA).insights.clientReport(
    { statuses: ["active", "paused", "completed"], limit: 1 },
    { now: NOW }
  );

  assert.equal(result.insight, "client_report");
  assert.equal(result.data.days, 7);
  assert.equal(result.data.campaigns, 4);
  assert.deepEqual(result.data.period, {
    from: "2026-11-07",
    to: "2026-11-13",
  });
  assert.deepEqual(result.data.previousPeriod, {
    from: "2026-10-31",
    to: "2026-11-06",
  });
  // Current: 400 + 300 + 200 + 20 sends, 70 + 140 + 70 + 20 contacted,
  // 14 + 14 + 2 + 1 replies, 4 + 3 + 20 bounces. Previous: 900 sends,
  // 280 contacted, 12 + 14 + 9 replies, 2 bounces. Replies are divided by
  // messages sent, not leads contacted. Small reports no bounces,
  // so the 27 are divided by the other three's 900 sends, not by 920; in the
  // earlier period only Bouncy reports them: 2 of its 200.
  assert.deepEqual(result.data.totals.current, {
    bounceRate: 0.03,
    bounced: 27,
    contacted: 300,
    positive: null,
    positiveRate: null,
    replied: 31,
    replyRate: 0.0337,
    sent: 920,
  });
  assert.deepEqual(result.data.totals.previous, {
    bounceRate: 0.01,
    bounced: 2,
    contacted: 280,
    positive: null,
    positiveRate: null,
    replied: 35,
    replyRate: 0.0389,
    sent: 900,
  });
  assert.equal(result.data.replyRateBasis, "sent");
  assert.equal(result.data.totals.replyRateBasis, "sent");
  assert.equal(result.data.totals.change.replyRate, -0.0052);
  assert.equal(result.data.totals.change.sent, 20);
  // 31 of 920 against 35 of 900: z = -0.59, p = 0.55.
  assert.equal(result.data.totals.verdict, "no_real_change");
  assert.equal(result.data.totals.replyRateTest?.pValue, 0.5535);
  // Per message sent, 14 of 300 has a low end of 2.8%, 14 of 400 has 2.1%
  // and 2 of 200 has 0.27%: Middling leads, though Winner leads per lead.
  assert.deepEqual(result.data.top, [
    {
      basis: "sent",
      campaign: "memory:agency:b",
      channel: "email",
      count: 14,
      high: 0.0768,
      low: 0.028,
      campaignName: "Middling",
      of: 300,
      provider: "memory",
      rank: 1,
      rate: 0.0467,
      sent: 300,
      status: "active",
    },
  ]);
  assert.deepEqual(
    result.data.bottom.map((each) => [
      each.campaignName,
      each.rank,
      each.count,
      each.of,
      each.rate,
      each.low,
    ]),
    [["Bouncy", 3, 2, 200, 0.01, 0.0027]]
  );
  assert.deepEqual(result.data.bounceProblems, [
    {
      bounced: 20,
      campaign: "memory:agency:c",
      channel: "email",
      // The Measured shape: count over of, the same as bounced over sent.
      count: 20,
      high: 0.1494,
      low: 0.0657,
      campaignName: "Bouncy",
      of: 200,
      provider: "memory",
      rate: 0.1,
      sent: 200,
      status: "active",
    },
  ]);
  // The workspace's replies per day before 11-11 were 14, 12, 9, 15 and 14:
  // mean 12.8, deviation sqrt(22.8 / 4) = 2.3875; 2 replies is z = -4.52.
  assert.deepEqual(
    result.data.anomalies?.map((each) => [
      each.date,
      each.metric,
      each.value,
      each.baselineMean,
      each.zScore,
      each.direction,
    ]),
    [["2026-11-11", "replied", 2, 12.8, -4.5236, "below"]]
  );
  // Leads contacted per day: Winner 70 / 7 = 10 with 100 leads (10 days, not
  // flagged), Middling 140 / 7 = 20 with 40, Bouncy 10 with 5.
  assert.deepEqual(result.data.runningOutOfLeads, [
    {
      campaign: "memory:agency:c",
      channel: "email",
      dailyContactRate: 10,
      daysLeft: 0.5,
      campaignName: "Bouncy",
      provider: "memory",
      remaining: 5,
      status: "active",
    },
    {
      campaign: "memory:agency:b",
      channel: "email",
      dailyContactRate: 20,
      daysLeft: 2,
      campaignName: "Middling",
      provider: "memory",
      remaining: 40,
      status: "active",
    },
  ]);
  assert.deepEqual(result.data.actions, [
    {
      action:
        "Fix the bounces of Bouncy: its bounce rate is 10% (20 of 200 sends).",
      campaign: "memory:agency:c",
      campaignName: "Bouncy",
      kind: "fix_bounces",
      number: 0.1,
    },
    {
      action: "Add leads to Bouncy: 5 leads remain, about 0.5 days of sending.",
      campaign: "memory:agency:c",
      campaignName: "Bouncy",
      kind: "add_leads",
      number: 0.5,
    },
    {
      action:
        "Add leads to Middling: 40 leads remain, about 2 days of sending.",
      campaign: "memory:agency:b",
      campaignName: "Middling",
      kind: "add_leads",
      number: 2,
    },
    {
      action:
        "Review the copy and the audience of Bouncy: it has the fewest replies per message sent, 1% (2 of 200).",
      campaign: "memory:agency:c",
      campaignName: "Bouncy",
      kind: "review_campaign",
      number: 0.01,
    },
    {
      action:
        "Check what happened on 2026-11-11: replied was 2 on 2026-11-11, against an average of 12.8 over the 5 days with data before it (z = -4.5).",
      campaign: null,
      campaignName: null,
      kind: "check_anomaly",
      number: 2,
    },
  ]);
  assert.deepEqual(result.data.leftOut, []);
  assert.equal(result.meta.complete, true);
  assert.deepEqual(result.meta.notes, [BOUNCE_NOTE]);
});

test("client_report moves with top, the bounce limit, min_sent and the runway", async () => {
  const outbound = single(DATA);

  const wide = await outbound.insights.clientReport(
    { statuses: ["active", "paused", "completed"] },
    { now: NOW }
  );

  // Three campaigns are ranked and the default top is 3: none is left for the bottom.
  assert.deepEqual(
    wide.data.top.map((each) => each.campaignName),
    ["Middling", "Winner", "Bouncy"]
  );
  assert.deepEqual(wide.data.bottom, []);
  assert.ok(!wide.data.actions.some((each) => each.kind === "review_campaign"));

  const tolerant = await outbound.insights.clientReport(
    { statuses: ["active", "paused", "completed"], max_bounce_rate: 0.2 },
    { now: NOW }
  );

  assert.deepEqual(tolerant.data.bounceProblems, []);
  assert.ok(!tolerant.data.actions.some((each) => each.kind === "fix_bounces"));

  const strict = await outbound.insights.clientReport(
    { statuses: ["active", "paused", "completed"], min_sent: 250 },
    { now: NOW }
  );

  // Bouncy's 200 sends are now too few to rank or to call a bounce problem.
  assert.deepEqual(
    strict.data.top.map((each) => each.campaignName),
    ["Middling", "Winner"]
  );
  assert.deepEqual(strict.data.bounceProblems, []);

  const short = await outbound.insights.clientReport(
    { statuses: ["active", "paused", "completed"], runway_days: 1 },
    { now: NOW }
  );

  assert.deepEqual(
    short.data.runningOutOfLeads?.map((each) => each.campaignName),
    ["Bouncy"]
  );

  const long = await outbound.insights.clientReport(
    { statuses: ["active", "paused", "completed"], runway_days: 10 },
    { now: NOW }
  );

  assert.deepEqual(
    long.data.runningOutOfLeads?.map((each) => [
      each.campaignName,
      each.daysLeft,
    ]),
    [
      ["Bouncy", 0.5],
      ["Middling", 2],
      ["Winner", 10],
    ]
  );
});

test("client_report moves with the anomaly settings, alpha and the days", async () => {
  const outbound = single(DATA);

  const sensitive = await outbound.insights.clientReport(
    { statuses: ["active", "paused", "completed"], anomaly_threshold: 1.3 },
    { now: NOW }
  );

  // Sends before 11-11 were 300, 400, 200, 320 and 400: mean 324, deviation
  // sqrt(27520 / 4) = 82.95; 200 sends is z = -1.495.
  assert.deepEqual(
    sensitive.data.anomalies?.map((each) => [
      each.metric,
      each.value,
      each.baselineMean,
      each.zScore,
    ]),
    [
      ["replied", 2, 12.8, -4.5236],
      ["sent", 200, 324, -1.495],
    ]
  );

  const demanding = await outbound.insights.clientReport(
    { statuses: ["active", "paused", "completed"], min_baseline_points: 6 },
    { now: NOW }
  );

  assert.deepEqual(demanding.data.anomalies, []);

  // Only 11-04 falls in a 5-day baseline before 11-07, so no day can be tested.
  const brief = await outbound.insights.clientReport(
    { statuses: ["active", "paused", "completed"], baseline_days: 5 },
    { now: NOW }
  );

  assert.deepEqual(brief.data.anomalies, []);

  const credulous = await outbound.insights.clientReport(
    { statuses: ["active", "paused", "completed"], alpha: 0.6 },
    { now: NOW }
  );

  assert.equal(credulous.data.totals.verdict, "down");
  assert.deepEqual(
    credulous.data.actions.find((each) => each.kind === "reply_rate_fell"),
    {
      action:
        "Find out what changed: replies per message sent fell from 3.9% to 3.4%, more than chance would give.",
      campaign: null,
      campaignName: null,
      kind: "reply_rate_fell",
      number: -0.0052,
    }
  );

  // Three days: 11-11 to 11-13 against 11-08 to 11-10.
  const three = await outbound.insights.clientReport(
    { statuses: ["active", "paused", "completed"], days: 3 },
    { now: NOW }
  );

  assert.deepEqual(three.data.period, { from: "2026-11-11", to: "2026-11-13" });
  assert.deepEqual(
    [three.data.totals.current.sent, three.data.totals.previous.sent],
    [200, 720]
  );
});

test("client_report leaves out the sections the adapter cannot serve, and names them", async () => {
  const unusual = "Unusual days: the adapter has no workspace stats by day.";

  const runway =
    "Campaigns running out of leads: the adapter cannot list a campaign's leads or has no stats by day.";

  const noDays = await single(DATA, {
    "stats.byDay": false,
  }).insights.clientReport(
    { statuses: ["active", "paused", "completed"], limit: 1 },
    { now: NOW }
  );

  assert.equal(noDays.data.anomalies, null);
  assert.equal(noDays.data.runningOutOfLeads, null);
  assert.deepEqual(noDays.data.leftOut, [unusual, runway]);
  assert.deepEqual(noDays.meta.notes, [
    BOUNCE_NOTE,
    `Left out. ${unusual}`,
    `Left out. ${runway}`,
  ]);
  // The rest of the report is still there.
  assert.equal(noDays.data.totals.current.sent, 920);
  assert.deepEqual(
    noDays.data.actions.map((each) => each.kind),
    ["fix_bounces", "review_campaign"]
  );

  const noLeads = await single(DATA, {
    "leads.byCampaign": false,
  }).insights.clientReport(
    { statuses: ["active", "paused", "completed"] },
    { now: NOW }
  );

  assert.equal(noLeads.data.runningOutOfLeads, null);
  assert.equal(noLeads.data.anomalies?.length, 1);
  assert.deepEqual(noLeads.data.leftOut, [runway]);

  const noWorkspace = await single(DATA, {
    "stats.workspace": false,
  }).insights.clientReport(
    { statuses: ["active", "paused", "completed"] },
    { now: NOW }
  );

  assert.equal(noWorkspace.data.anomalies, null);
  assert.equal(noWorkspace.data.runningOutOfLeads?.length, 2);
  assert.deepEqual(noWorkspace.data.leftOut, [unusual]);

  await assert.rejects(
    async () =>
      await single(DATA, { "stats.campaign": false }).insights.clientReport({
        statuses: ["active", "paused", "completed"],
      }),
    unsupported("stats.campaign")
  );
});

test("client_report is empty without campaigns, and says when a cap cut what it read", async () => {
  const empty = await single({}).insights.clientReport(
    { statuses: ["active", "paused", "completed"] },
    { now: NOW }
  );

  assert.equal(empty.data.campaigns, 0);
  assert.equal(empty.data.totals.current.sent, null);
  assert.equal(empty.data.totals.current.replyRate, null);
  assert.equal(empty.data.totals.verdict, "unknown");
  assert.deepEqual(empty.data.top, []);
  assert.deepEqual(empty.data.bottom, []);
  assert.deepEqual(empty.data.bounceProblems, []);
  assert.deepEqual(empty.data.anomalies, []);
  assert.deepEqual(empty.data.runningOutOfLeads, []);
  assert.deepEqual(empty.data.actions, []);
  assert.equal(empty.meta.complete, true);

  const capped = await single(DATA).insights.clientReport(
    { statuses: ["active", "paused", "completed"], max_campaigns: 1 },
    { now: NOW }
  );

  assert.equal(capped.data.campaigns, 1);
  assert.equal(capped.meta.complete, false);

  // Winner has 100 leads: with 50 read its runway is a minimum, so it is not
  // flagged even with a runway that would catch it, and the answer says it is partial.
  const fewLeads = await single(DATA).insights.clientReport(
    {
      statuses: ["active", "paused", "completed"],
      max_leads_per_campaign: 50,
      runway_days: 10,
    },
    { now: NOW }
  );

  assert.deepEqual(
    fewLeads.data.runningOutOfLeads?.map((each) => each.campaignName),
    ["Bouncy", "Middling"]
  );
  assert.equal(fewLeads.meta.complete, false);
  assert.ok(
    fewLeads.meta.notes.includes(
      "The leads left were not fully counted for 1 active campaign, so runningOutOfLeads leaves it out: Winner. Raise max_leads_per_campaign to count them."
    ),
    fewLeads.meta.notes.join(" | ")
  );
});

test("client_report covers the campaigns of two tools in one report", async () => {
  const result = await pair(DATA, {
    campaigns: [{ channel: "linkedin", id: "k1", name: "Seats" }],
    leads: [
      {
        campaignId: "k1",
        id: "p1",
        linkedinUrl: "https://www.linkedin.com/in/example-person-1",
      },
    ],
    stats: [
      row("k1", "2026-11-05", { contacted: 100, replied: 20, sent: 100 }),
      row("k1", "2026-11-12", { contacted: 100, replied: 25, sent: 100 }),
    ],
  }).insights.clientReport(
    { statuses: ["active", "paused", "completed"], limit: 1 },
    { now: NOW }
  );

  assert.equal(result.data.campaigns, 5);
  // 25 of 100 has a low end of 17.55%, above Winner's 12.3%.
  assert.deepEqual(
    result.data.top.map((each) => [each.campaign, each.provider, each.low]),
    [["lntool:agency:k1", "lntool", 0.1755]]
  );
  assert.deepEqual(
    [result.data.totals.current.sent, result.data.totals.current.replied],
    [1020, 56]
  );
  // One lead left at 100 / 7 = 14.29 a day.
  assert.deepEqual(
    result.data.runningOutOfLeads?.map((each) => [
      each.campaignName,
      each.daysLeft,
    ]),
    [
      ["Seats", 0.07],
      ["Bouncy", 0.5],
      ["Middling", 2],
    ]
  );
  assert.equal(result.meta.provider, "combined");
});

test("client_report divides by leads contacted when the vendor reports no messages sent, and says so", async () => {
  // 3 of 100 before and 9 of 60 now: no row counts messages sent.
  const result = await single({
    campaigns: [
      { id: "k", name: "Seats" },
      { id: "m", name: "Founders" },
    ],
    stats: [
      row("k", "2026-11-02", { contacted: 50, replied: 1 }),
      row("m", "2026-11-02", { contacted: 50, replied: 2 }),
      row("k", "2026-11-09", { contacted: 30, replied: 6 }),
      row("m", "2026-11-09", { contacted: 30, replied: 3 }),
    ],
  }).insights.clientReport(
    { statuses: ["active", "paused", "completed"], limit: 1, min_sent: 10 },
    { now: NOW }
  );

  assert.equal(result.data.replyRateBasis, "contacted");
  assert.equal(result.data.totals.replyRateBasis, "contacted");
  assert.deepEqual(
    [
      result.data.totals.previous.replyRate,
      result.data.totals.current.replyRate,
    ],
    [0.03, 0.15]
  );
  assert.match(
    result.data.totals.finding,
    /^Replies per lead contacted went from 3% to 15%; /u
  );
  // 6 of 30 against 3 of 30, both per lead contacted.
  assert.deepEqual(
    [...result.data.top, ...result.data.bottom].map((each) => [
      each.campaignName,
      each.of,
      each.basis,
    ]),
    [
      ["Seats", 30, "contacted"],
      ["Founders", 30, "contacted"],
    ]
  );
  assert.match(
    result.data.actions.find((each) => each.kind === "review_campaign")
      ?.action ?? "",
    /fewest replies per lead contacted/u
  );
});
