import assert from "node:assert/strict";
import { test } from "node:test";

import { OutboundError } from "../../src/index.ts";
import type { MemoryData, MemoryLead } from "../../src/memory/index.ts";
import { NOW, single } from "./helpers.ts";
import { pair, row, unsupported } from "./ops-helpers.ts";

const lead = (
  id: string,
  campaignId: string,
  status: NonNullable<MemoryLead["status"]>
): MemoryLead => ({ campaignId, email: `${id}@example.com`, id, status });

// 6 leads that are done or stopped, then 40 that are still active.
const LEADS: MemoryLead[] = [
  lead("r1", "c1", "replied"),
  lead("r2", "c1", "replied"),
  lead("b1", "c1", "bounced"),
  lead("d1", "c1", "completed"),
  lead("u1", "c1", "unsubscribed"),
  lead("p1", "c1", "paused"),
  ...Array.from({ length: 40 }, (_, index) =>
    lead(`a${index}`, "c1", "active")
  ),
];

// NOW is 2026-11-14: the last 7 complete days are 11-07 to 11-13.
const DATA: MemoryData = {
  campaigns: [
    { id: "c1", name: "Pipeline" },
    { id: "c2", name: "Fresh" },
    { id: "c3", name: "Drained" },
  ],
  leads: [
    ...LEADS,
    lead("f1", "c2", "active"),
    lead("f2", "c2", "active"),
    lead("f3", "c2", "active"),
  ],
  stats: [
    row("c1", "2026-10-01", {
      contacted: 186,
      positive: 5,
      replied: 20,
      sent: 480,
    }),
    row("c1", "2026-11-08", { contacted: 6, sent: 10 }),
    row("c1", "2026-11-10", { contacted: 8, sent: 10 }),
    // Sends without a count of leads contacted.
    row("c2", "2026-11-10", { sent: 9 }),
    row("c3", "2026-11-09", { contacted: 7, replied: 1, sent: 7 }),
  ],
};

const C1 = { campaign: "memory:agency:c1" };

test("pipeline_forecast counts the leads left and projects replies from the reply rate so far", async () => {
  const result = await single(DATA).insights.pipelineForecast(C1, { now: NOW });

  assert.equal(result.insight, "pipeline_forecast");

  const { assumptions, ...rest } = result.data;

  assert.deepEqual(rest, {
    byStatus: {
      active: 40,
      bounced: 1,
      completed: 1,
      paused: 1,
      replied: 2,
      skipped: 0,
      unknown: 0,
      unsubscribed: 1,
    },
    campaign: "memory:agency:c1",
    channel: "email",
    // 6 + 8 leads contacted over the 7 days.
    dailyContactRate: 2,
    // 40 leads at 2 a day.
    daysLeft: 20,
    estimate: true,
    // 5 positive of 200 contacted = 2.5%, interval 1.07% to 5.72%: 40 x each.
    expectedPositive: { expected: 1, high: 2.288, low: 0.428 },
    // 20 replies of 200 contacted = 10%, interval 6.57% to 14.94%: 40 x each.
    expectedReplies: { expected: 4, high: 5.976, low: 2.628 },
    finding:
      "40 leads remain; expect about 4 replies (between 2.6 and 6). This is an estimate.",
    inSequence: null,
    leadsComplete: true,
    leadsRead: 46,
    campaignName: "Pipeline",
    notStarted: null,
    positiveRate: { count: 5, high: 0.0572, low: 0.0107, of: 200, rate: 0.025 },
    provider: "memory",
    remaining: 40,
    replyRate: { count: 20, high: 0.1494, low: 0.0657, of: 200, rate: 0.1 },
    status: "active",
  });
  assert.equal(assumptions.length, 4);
  assert.equal(
    assumptions.at(-1),
    "The reply rate so far is 10%, from 20 replies over 200."
  );
  assert.equal(result.meta.complete, true);
  assert.deepEqual(result.meta.notes, []);
});

test("pipeline_forecast sets the pace from the days it is given, and says when max_leads cut the count", async () => {
  const outbound = single(DATA);

  // 14 days back reaches 10-31: the same 14 leads over twice the days.
  const slow = await outbound.insights.pipelineForecast(
    { ...C1, days: 14 },
    { now: NOW }
  );

  assert.equal(slow.data.dailyContactRate, 1);
  assert.equal(slow.data.daysLeft, 40);

  const capped = await outbound.insights.pipelineForecast(
    { ...C1, max_leads: 30 },
    { now: NOW }
  );

  // The first 30 leads hold the 6 that are done and 24 active ones.
  assert.equal(capped.data.leadsRead, 30);
  assert.equal(capped.data.leadsComplete, false);
  assert.equal(capped.data.remaining, 24);
  assert.match(capped.data.finding, /^At least 24 leads remain/u);
  assert.equal(capped.meta.complete, false);
});

test("pipeline_forecast keeps unknowns unknown, and reports a drained campaign as zero", async () => {
  const outbound = single(DATA);

  const fresh = await outbound.insights.pipelineForecast(
    { campaign: "memory:agency:c2" },
    { now: NOW }
  );

  assert.equal(fresh.data.remaining, 3);
  assert.equal(fresh.data.replyRate.rate, null);
  assert.equal(fresh.data.replyRate.count, null);
  assert.deepEqual(fresh.data.expectedReplies, {
    expected: null,
    high: null,
    low: null,
  });
  assert.equal(fresh.data.dailyContactRate, null);
  assert.equal(fresh.data.daysLeft, null);
  assert.equal(
    fresh.data.finding,
    "3 leads remain; replies cannot be estimated because the vendor reports no reply rate yet."
  );
  assert.equal(
    fresh.data.assumptions.at(-1),
    "The reply rate so far is unknown, from an unknown number of replies over 9."
  );

  const drained = await outbound.insights.pipelineForecast(
    { campaign: "memory:agency:c3" },
    { now: NOW }
  );

  assert.equal(drained.data.leadsRead, 0);
  assert.equal(drained.data.remaining, 0);
  // 7 contacted over 7 days.
  assert.equal(drained.data.dailyContactRate, 1);
  assert.equal(drained.data.daysLeft, 0);
  assert.deepEqual(drained.data.expectedReplies, {
    expected: 0,
    high: 0,
    low: 0,
  });
});

test("pipeline_forecast leaves the days left out without stats by day, and needs leads by campaign and campaign stats", async () => {
  const result = await single(DATA, {
    "stats.byDay": false,
  }).insights.pipelineForecast(C1, { now: NOW });

  assert.equal(result.data.dailyContactRate, null);
  assert.equal(result.data.daysLeft, null);
  assert.equal(result.data.expectedReplies.expected, 4);
  assert.deepEqual(result.meta.notes, [
    "Days of sending left were not estimated: the adapter has no stats by day.",
  ]);

  await assert.rejects(
    async () =>
      await single(DATA, {
        "leads.byCampaign": false,
      }).insights.pipelineForecast(C1),
    unsupported("leads.byCampaign")
  );
  await assert.rejects(
    async () =>
      await single(DATA, {
        "stats.campaign": false,
      }).insights.pipelineForecast(C1),
    unsupported("stats.campaign")
  );
  await assert.rejects(
    async () =>
      await single(DATA).insights.pipelineForecast({
        campaign: "memory:agency:nope",
      }),
    (error) => OutboundError.is(error) && error.code === "NotFound"
  );
});

test("pipeline_forecast reads a campaign of either tool on a combined instance", async () => {
  const result = await pair(DATA, {
    campaigns: [{ channel: "linkedin", id: "k1", name: "Seats" }],
    leads: [
      {
        campaignId: "k1",
        id: "p1",
        linkedinUrl: "https://www.linkedin.com/in/example-person-1",
      },
      {
        campaignId: "k1",
        id: "p2",
        linkedinUrl: "https://www.linkedin.com/in/example-person-2",
        status: "replied",
      },
    ],
    stats: [
      row("k1", "2026-11-11", { contacted: 7, sent: 7 }),
      row("k1", "2026-10-11", { contacted: 93, replied: 10, sent: 93 }),
    ],
  }).insights.pipelineForecast({ campaign: "lntool:agency:k1" }, { now: NOW });

  // 10 replies of 100 contacted: one lead left at 10%, interval 5.52% to 17.44%.
  assert.deepEqual(
    [
      result.data.channel,
      result.data.provider,
      result.data.remaining,
      result.data.dailyContactRate,
      result.data.daysLeft,
    ],
    ["linkedin", "lntool", 1, 1, 1]
  );
  assert.deepEqual(result.data.expectedReplies, {
    expected: 0.1,
    high: 0.1744,
    low: 0.0552,
  });
});

// An active campaign whose leads are all finished: it stopped contacting new
// leads ten days ago, so it has no recent contact rate (OUT-56).
const FINISHED: MemoryData = {
  campaigns: [
    { id: "done", name: "Founders", status: "active" },
    { id: "busy", name: "Agencies", status: "active" },
  ],
  leads: [
    ...Array.from({ length: 40 }, (_, index) =>
      lead(`d${index}`, "done", "completed")
    ),
    ...Array.from({ length: 6 }, (_, index) =>
      lead(`b${index}`, "busy", "active")
    ),
  ],
  stats: [
    row("done", "2026-11-03", { contacted: 40, replied: 2, sent: 80 }),
    row("done", "2026-11-11", { contacted: 0, replied: 1, sent: 60 }),
    row("busy", "2026-11-11", { contacted: 7, replied: 1, sent: 70 }),
  ],
};

test("pipeline_forecast gives a campaign with no leads left 0 days, even with no contact rate", async () => {
  const outbound = single(FINISHED);

  const done = await outbound.insights.pipelineForecast(
    { campaign: "memory:agency:done" },
    { now: NOW }
  );

  assert.equal(done.data.remaining, 0);
  assert.equal(done.data.dailyContactRate, 0);
  assert.equal(done.data.daysLeft, 0);
  assert.equal(
    done.data.finding,
    "No leads are left to contact; add leads to keep the campaign sending."
  );

  // Cut off by the cap, the leads left are unknown, so the days left are too.
  const capped = await outbound.insights.pipelineForecast(
    { campaign: "memory:agency:done", max_leads: 10 },
    { now: NOW }
  );

  assert.equal(capped.data.remaining, 0);
  assert.equal(capped.data.daysLeft, null);

  // Leads whose status the vendor does not say may still be waiting.
  const unknown = await single({
    ...FINISHED,
    leads: [lead("u1", "done", "unknown")],
  }).insights.pipelineForecast(
    { campaign: "memory:agency:done" },
    { now: NOW }
  );

  assert.equal(unknown.data.daysLeft, null);
});

test("client_report lists a campaign with no leads left first, with the action to add leads", async () => {
  const report = await single(FINISHED).insights.clientReport(
    { min_sent: 1 },
    { now: NOW }
  );

  assert.deepEqual(
    report.data.runningOutOfLeads?.map((each) => [
      each.campaignName,
      each.daysLeft,
    ]),
    [
      ["Founders", 0],
      ["Agencies", 6],
    ]
  );

  const first = report.data.actions.find(
    (action) => action.kind === "add_leads"
  );

  assert.deepEqual(first, {
    action:
      "Add leads to Founders: no leads are left to contact, so it is not sending.",
    campaign: "memory:agency:done",
    campaignName: "Founders",
    kind: "add_leads",
    number: 0,
  });
});

test("pipeline_forecast writes one lead in the singular and leaves out a range whose ends read the same", async () => {
  // c1 read up to its first lead, which has replied: at least 0 leads remain.
  const none = await single(DATA).insights.pipelineForecast(
    { ...C1, max_leads: 1 },
    { now: NOW }
  );

  assert.equal(
    none.data.finding,
    "At least 0 leads remain; expect about 0 replies. This is an estimate."
  );

  const one = await single({
    ...DATA,
    leads: [lead("solo", "c1", "active")],
  }).insights.pipelineForecast(C1, { now: NOW });

  assert.match(
    one.data.finding,
    /^1 lead remains; expect about 0\.\d replies/u
  );
});
