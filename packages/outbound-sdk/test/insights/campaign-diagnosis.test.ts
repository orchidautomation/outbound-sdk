import assert from "node:assert/strict";
import { test } from "node:test";

import type {
  MemoryData,
  MemoryLead,
  MemorySender,
} from "../../src/memory/index.ts";
import { NOW, single } from "./helpers.ts";
import { pair, row, unsupported } from "./ops-helpers.ts";

const same = (campaignId: string, date: string, sent: number) =>
  row(campaignId, date, { contacted: sent, sent });

// NOW is 2026-11-14: the last 7 complete days are 11-07 to 11-13, and the 7
// before are 10-31 to 11-06.
const DATA: MemoryData = {
  campaigns: [
    {
      id: "bad",
      name: "Struggling",
      settings: {
        dailyLimit: 50,
        // Monday to Wednesday, three hours each: 9 hours a week.
        schedule: [{ days: [1, 2, 3], from: "09:00", to: "12:00" }],
        trackOpens: false,
      },
      steps: [{ variants: [{ body: "Hello", subject: "Quick question" }] }],
    },
    {
      id: "good",
      name: "Healthy",
      settings: {
        dailyLimit: 500,
        schedule: [{ days: [1, 2, 3, 4, 5], from: "09:00", to: "17:00" }],
        trackOpens: true,
      },
      steps: [
        { variants: [{ body: "One" }] },
        { variants: [{ body: "Two" }] },
        { variants: [{ body: "Three" }] },
      ],
    },
    { id: "idle", name: "Idle", status: "paused" },
    { id: "dark", name: "Dark" },
    { id: "blank", name: "Blank" },
  ],
  senders: [
    { address: "one@send.example", campaignIds: ["bad", "good"], id: "s1" },
    {
      address: "two@send.example",
      campaignIds: ["bad"],
      id: "s2",
      status: "disconnected",
    },
  ],
  stats: [
    row("bad", "2026-10-10", {
      bounced: 80,
      contacted: 1302,
      positive: 1,
      replied: 10,
      sent: 1302,
    }),
    same("bad", "2026-11-01", 300),
    same("bad", "2026-11-03", 300),
    same("bad", "2026-11-08", 50),
    same("bad", "2026-11-10", 48),
    row("good", "2026-11-02", {
      bounced: 2,
      contacted: 400,
      opened: 200,
      positive: 20,
      replied: 40,
      sent: 400,
    }),
    row("good", "2026-11-09", {
      bounced: 2,
      contacted: 400,
      opened: 210,
      positive: 20,
      replied: 40,
      sent: 400,
    }),
    row("idle", "2026-10-01", {
      bounced: 1,
      contacted: 200,
      positive: 5,
      replied: 10,
      sent: 200,
    }),
    // Sends only: replies, positives and bounces are unknown.
    row("dark", "2026-11-09", { sent: 500 }),
  ],
};

const BAD = { campaign: "memory:agency:bad" };

const codes = (result: {
  data: { findings: readonly { code: string; severity: string }[] };
}) => result.data.findings.map((each) => each.code);

test("campaign_diagnosis lists what is wrong with a campaign, most serious first, with the numbers", async () => {
  const result = await single(DATA).insights.campaignDiagnosis(BAD, {
    now: NOW,
  });

  assert.equal(result.insight, "campaign_diagnosis");
  assert.deepEqual(
    [result.data.campaign, result.data.campaignName, result.data.status],
    ["memory:agency:bad", "Struggling", "active"]
  );
  // 1,302 + 300 + 300 + 50 + 48 sends.
  assert.deepEqual(result.data.totals, {
    bounced: 80,
    contacted: 2000,
    positive: 1,
    replied: 10,
    sent: 2000,
  });
  assert.equal(result.data.rates.replyRate.rate, 0.005);
  assert.deepEqual(result.data.findings, [
    {
      code: "high_bounce_rate",
      finding: "Bounce rate is 4% (80 of 2000 sends), over the 3% limit.",
      next: "Use bounce_watch to find the senders behind it, and verify the lead list.",
      numbers: {
        bounced: 80,
        high: 0.0495,
        limit: 0.03,
        low: 0.0323,
        rate: 0.04,
        sent: 2000,
      },
      severity: "high",
    },
    {
      code: "inactive_sender",
      finding: "1 of 2 senders is not active: two@send.example (disconnected).",
      next: "Reconnect or replace them; warmup_readiness shows which mailboxes are fit to send.",
      numbers: { inactive: 1, senders: 2, warmupZero: 0 },
      severity: "high",
    },
    {
      code: "low_reply_rate",
      // 10 of 2,000 is 0.5%; the top of its interval, 0.92%, is still under 1%.
      finding:
        "Reply rate is 0.5% (10 of 2000), under the 1% floor. The 95% interval is 0.3% to 0.9%, so it is below the floor beyond chance.",
      next: "Use step_funnel and copy_audit to see where replies are lost.",
      numbers: {
        floor: 0.01,
        high: 0.0092,
        low: 0.0027,
        rate: 0.005,
        replied: 10,
        sample: 2000,
      },
      severity: "high",
    },
    {
      code: "falling_sends",
      // 50 + 48 = 98 against 300 + 300 = 600: a drop of 1 - 98/600 = 83.67%.
      finding:
        "Sends fell from 600 to 98 over the last 7 days against the 7 before, a drop of 83.7%.",
      next: "Use pipeline_forecast to check the leads left, and sender_capacity for the mailboxes.",
      numbers: { before: 600, drop: 0.8367, sent: 98 },
      severity: "medium",
    },
    {
      code: "few_positive_replies",
      finding:
        "Only 1 of 10 replies (10%) are positive, under the 20% expected. With 10 replies the 95% interval is 1.8% to 40.4%.",
      next: "Read the replies: the offer or the audience may be off.",
      numbers: {
        high: 0.4042,
        limit: 0.2,
        low: 0.0179,
        positive: 1,
        sample: 10,
        share: 0.1,
      },
      severity: "medium",
    },
    {
      code: "short_sequence",
      finding:
        "The sequence has 1 step; follow-ups usually bring a large share of the replies.",
      next: "Add follow-up steps; step_funnel shows what each step earns.",
      numbers: { steps: 1 },
      severity: "medium",
    },
    {
      code: "schedule_limits_volume",
      // Two sending days averaged (50 + 48) / 2 = 49, at 98% of the limit of 50.
      finding:
        "The sending windows are open 9 hours a week, under 20. Recent sending days average 49 sends against a daily limit of 50, so the limit is what holds volume back.",
      next: "Use settings_audit to review the schedule and the limits.",
      numbers: { averageDailySent: 49, dailyLimit: 50, weeklyHours: 9 },
      severity: "low",
    },
    {
      code: "tracking_off",
      finding:
        "Open tracking is off, so the missing open count is expected and not a fault.",
      next: "Judge this campaign on replies, not opens.",
      numbers: { opened: null },
      severity: "low",
    },
  ]);
  assert.deepEqual(result.data.notChecked, []);
  assert.equal(
    result.data.summary,
    "8 findings. Most serious: Bounce rate is 4% (80 of 2000 sends), over the 3% limit."
  );
  assert.equal(result.meta.complete, true);
});

test("campaign_diagnosis finds nothing wrong with a healthy campaign, or with a paused one that stopped sending", async () => {
  const outbound = single(DATA);

  const good = await outbound.insights.campaignDiagnosis(
    { campaign: "memory:agency:good" },
    { now: NOW }
  );

  assert.deepEqual(good.data.findings, []);
  assert.deepEqual(good.data.notChecked, []);
  assert.equal(
    good.data.summary,
    "No problem was found in what could be checked."
  );
  assert.equal(good.data.rates.replyRate.rate, 0.1);

  const idle = await outbound.insights.campaignDiagnosis(
    { campaign: "memory:agency:idle" },
    { now: NOW }
  );

  assert.deepEqual(codes(idle), []);
});

test("campaign_diagnosis moves with each threshold", async () => {
  const outbound = single(DATA);

  const run = async (input: Record<string, number | string>) =>
    codes(
      await outbound.insights.campaignDiagnosis(
        { ...BAD, ...input },
        { now: NOW }
      )
    );

  const all = await run({});

  const without = (code: string) => all.filter((each) => each !== code);

  assert.deepEqual(
    await run({ max_bounce_rate: 0.05 }),
    without("high_bounce_rate")
  );
  assert.deepEqual(
    await run({ min_reply_rate: 0.004 }),
    without("low_reply_rate")
  );
  assert.deepEqual(
    await run({ min_positive_share: 0.05 }),
    without("few_positive_replies")
  );
  assert.deepEqual(await run({ max_send_drop: 0.9 }), without("falling_sends"));
  assert.deepEqual(
    await run({ daily_limit_share: 1, min_weekly_hours: 9 }),
    without("schedule_limits_volume")
  );

  // Under 5,000 sends nothing is said about rates.
  assert.deepEqual(await run({ min_sent: 5000 }), [
    "inactive_sender",
    "falling_sends",
    "too_little_volume",
    "short_sequence",
    "schedule_limits_volume",
    "tracking_off",
  ]);

  // The last 3 days, 11-11 to 11-13, have no sends at all.
  assert.deepEqual(await run({ days: 3 }), [
    "high_bounce_rate",
    "no_recent_sends",
    "inactive_sender",
    "low_reply_rate",
    "few_positive_replies",
    "short_sequence",
    "schedule_limits_volume",
    "tracking_off",
  ]);
});

test("campaign_diagnosis words each finding from its own numbers", async () => {
  const outbound = single(DATA);

  // A floor of 0.8%: the interval's top, 0.92%, reaches it, so the verdict is softer.
  const soft = await outbound.insights.campaignDiagnosis(
    { ...BAD, min_reply_rate: 0.008 },
    { now: NOW }
  );

  const reply = soft.data.findings.find(
    (each) => each.code === "low_reply_rate"
  );

  assert.equal(reply?.severity, "medium");
  assert.match(reply?.finding ?? "", /which still reaches the floor/u);

  const hours = await outbound.insights.campaignDiagnosis(
    { ...BAD, daily_limit_share: 1 },
    { now: NOW }
  );

  assert.equal(
    hours.data.findings.find((each) => each.code === "schedule_limits_volume")
      ?.finding,
    "The sending windows are open 9 hours a week, under 20."
  );

  const small = await outbound.insights.campaignDiagnosis(
    { ...BAD, min_sent: 5000 },
    { now: NOW }
  );

  assert.deepEqual(
    small.data.findings.find((each) => each.code === "too_little_volume"),
    {
      code: "too_little_volume",
      finding:
        "Only 2000 sends, under the 5000 needed to judge a rate; reply and bounce rates are not assessed.",
      next: "Let the campaign run longer, or widen the date range.",
      numbers: { minSent: 5000, sent: 2000 },
      severity: "medium",
    }
  );

  const stopped = await outbound.insights.campaignDiagnosis(
    { ...BAD, days: 3 },
    { now: NOW }
  );

  assert.deepEqual(
    stopped.data.findings.find((each) => each.code === "no_recent_sends"),
    {
      code: "no_recent_sends",
      finding:
        "The campaign is active but the vendor reports no sends in the last 3 days.",
      next: "Check its senders and schedule, and whether leads remain (pipeline_forecast).",
      numbers: { days: 3, sent: null },
      severity: "high",
    }
  );

  // From November on: 698 sends and no reply, positive or bounce count.
  const november = await outbound.insights.campaignDiagnosis(
    { ...BAD, from: "2026-11-01", to: "2026-11-30" },
    { now: NOW }
  );

  assert.deepEqual(november.data.period, {
    from: "2026-11-01",
    to: "2026-11-30",
  });
  assert.equal(november.data.totals.sent, 698);
  assert.equal(november.data.totals.replied, null);
  assert.ok(!codes(november).includes("low_reply_rate"));
});

test("campaign_diagnosis keeps unknown counts unknown and says what it could not judge", async () => {
  const outbound = single(DATA);

  const dark = await outbound.insights.campaignDiagnosis(
    { campaign: "memory:agency:dark" },
    { now: NOW }
  );

  assert.deepEqual(dark.data.totals, {
    bounced: null,
    contacted: null,
    positive: null,
    replied: null,
    sent: 500,
  });
  assert.equal(dark.data.rates.replyRate.rate, null);
  assert.equal(dark.data.rates.bounceRate.rate, null);
  // No settings, no steps and no senders are seeded: nothing is flagged from an absence.
  assert.deepEqual(dark.data.findings, []);
  assert.deepEqual(dark.data.notChecked, [
    "Reply rate: the vendor reports no reply or volume count.",
    "Bounce rate: the vendor reports no bounce or send count.",
    "Positive replies: the vendor reports no positive reply count.",
  ]);

  const blank = await outbound.insights.campaignDiagnosis(
    { campaign: "memory:agency:blank" },
    { now: NOW }
  );

  assert.deepEqual(codes(blank), ["no_recent_sends", "too_little_volume"]);
  assert.equal(
    blank.data.findings[1]?.finding,
    "The vendor reports no sends for this period, so no rate can be judged."
  );
  assert.deepEqual(blank.data.findings[1]?.numbers, {
    minSent: 50,
    sent: null,
  });
});

test("campaign_diagnosis skips what the adapter cannot serve and names it, and needs campaign stats", async () => {
  const result = await single(DATA, {
    "campaigns.settings": false,
    "senders.byCampaign": false,
    sequence: false,
    "stats.byDay": false,
  }).insights.campaignDiagnosis(BAD, { now: NOW });

  const skipped = [
    "Schedule and tracking: the adapter does not serve campaign settings.",
    "Sequence length: the adapter does not serve sequences.",
    "Sender status: the adapter cannot list a campaign's senders.",
    "Recent sending trend: the adapter has no stats by day.",
  ];

  assert.deepEqual(codes(result), [
    "high_bounce_rate",
    "low_reply_rate",
    "few_positive_replies",
  ]);
  assert.deepEqual(result.data.notChecked, skipped);
  assert.deepEqual(result.meta.notes, skipped);

  const capped = await single(DATA).insights.campaignDiagnosis(
    { ...BAD, max_senders: 1 },
    { now: NOW }
  );

  // Only the active sender was read, so the inactive one goes unseen and the answer says it is partial.
  assert.ok(!codes(capped).includes("inactive_sender"));
  assert.equal(capped.meta.complete, false);

  await assert.rejects(
    async () =>
      await single(DATA, {
        "stats.campaign": false,
      }).insights.campaignDiagnosis(BAD),
    unsupported("stats.campaign")
  );
});

test("campaign_diagnosis reads a campaign of either tool on a combined instance", async () => {
  const result = await pair(DATA, {
    campaigns: [
      {
        channel: "linkedin",
        id: "k1",
        name: "Seats",
        steps: [
          { variants: [{ body: "Hi" }] },
          { variants: [{ body: "Again" }] },
        ],
      },
    ],
    senders: [
      {
        campaignIds: ["k1"],
        id: "seat1",
        linkedinUrl: "https://www.linkedin.com/in/example-seat-1",
        name: "Seat one",
        status: "paused",
      },
    ],
    stats: [
      row("k1", "2026-11-09", { contacted: 400, replied: 40, sent: 400 }),
    ],
  }).insights.campaignDiagnosis({ campaign: "lntool:agency:k1" }, { now: NOW });

  assert.deepEqual(
    [
      result.data.channel,
      result.data.provider,
      result.data.rates.replyRate.rate,
    ],
    ["linkedin", "lntool", 0.1]
  );
  assert.deepEqual(
    result.data.findings.map((each) => [each.code, each.finding]),
    [
      ["inactive_sender", "1 of 1 sender is not active: Seat one (paused)."],
      [
        "short_sequence",
        "The sequence has 2 steps; follow-ups usually bring a large share of the replies.",
      ],
    ]
  );
});

test("campaign_diagnosis judges a campaign with 60 sends, as the other ops insights do", async () => {
  const result = await single({
    campaigns: [{ id: "few", name: "Few" }],
    stats: [row("few", "2026-11-10", { contacted: 60, replied: 0, sent: 60 })],
  }).insights.campaignDiagnosis({ campaign: "few" }, { now: NOW });

  const found = result.data.findings.map((each) => each.code);

  assert.ok(!found.includes("too_little_volume"), found.join(", "));
  assert.ok(found.includes("low_reply_rate"), found.join(", "));
});

const lead = (
  id: string,
  campaignId: string,
  status: NonNullable<MemoryLead["status"]>,
  started: boolean
): MemoryLead => {
  const seeded: MemoryLead = {
    campaignId,
    email: `${id}@example.com`,
    id,
    status,
  };

  // A lead whose first step went out; the others have not started.
  return started ? { ...seeded, engagement: { stepIndex: 0 } } : seeded;
};

const leads = (
  campaignId: string,
  count: number,
  status: NonNullable<MemoryLead["status"]>,
  started: boolean
): MemoryLead[] =>
  Array.from({ length: count }, (_, index) =>
    lead(
      `${campaignId}-${status}-${started}-${index}`,
      campaignId,
      status,
      started
    )
  );

// Live case (OUT-97): sends fell from 873 to 306 while only 28 leads were
// left to start, 0.64 days at the recent pace. Here the 7 days before sent
// 900 and the last 7 sent 280, starting 280 new leads: 40 a day.
const runout = (toStart: number): MemoryData => ({
  campaigns: [{ id: "drain", name: "Draining" }],
  leads: [
    ...leads("drain", 30, "completed", true),
    ...leads("drain", 12, "active", true),
    ...leads("drain", toStart, "active", false),
  ],
  stats: [
    row("drain", "2026-11-02", { contacted: 900, sent: 900 }),
    row("drain", "2026-11-09", { contacted: 140, sent: 140 }),
    row("drain", "2026-11-12", { contacted: 140, sent: 140 }),
  ],
});

const DRAIN = { campaign: "memory:agency:drain" };

test("campaign_diagnosis explains falling sends as lead runout when under a day of leads is left to start", async () => {
  const result = await single(runout(28)).insights.campaignDiagnosis(DRAIN, {
    now: NOW,
  });

  // 28 leads to start at 280 / 7 = 40 a day: 0.7 days.
  assert.deepEqual(result.data.findings, [
    {
      code: "out_of_leads",
      finding:
        "Sends fell from 900 to 280 over the last 7 days against the 7 before because the campaign is running out of leads: only 28 leads are left to start, under a day at the recent pace of 40 new leads a day. 12 leads are still finishing the sequence. This is lead runout, not a sending fault.",
      next: "Add leads to keep the campaign sending; pipeline_forecast shows what the leads left should produce.",
      numbers: {
        activeLeads: 40,
        before: 900,
        daysLeft: 0.7,
        drop: 0.6889,
        inSequence: 12,
        leadsToStart: 28,
        newLeadsPerDay: 40,
        sent: 280,
      },
      severity: "high",
    },
  ]);
  assert.equal(result.meta.complete, true);

  // pipeline_forecast gives the same days left for the same campaign and window.
  const forecast = await single(runout(28)).insights.pipelineForecast(DRAIN, {
    now: NOW,
  });

  assert.equal(forecast.data.daysLeft, 0.7);
});

test("campaign_diagnosis keeps falling_sends when leads are left, or when it cannot tell", async () => {
  // 80 leads to start at 40 a day: 2 days left, so the fall is not runout.
  const plenty = await single(runout(80)).insights.campaignDiagnosis(DRAIN, {
    now: NOW,
  });

  assert.deepEqual(codes(plenty), ["falling_sends"]);

  // The cap stopped the lead read, so the count left is a minimum and runout is not claimed.
  const capped = await single(runout(28)).insights.campaignDiagnosis(
    { ...DRAIN, max_leads: 10 },
    { now: NOW }
  );

  assert.deepEqual(codes(capped), ["falling_sends"]);
  assert.equal(capped.meta.complete, false);

  // The adapter cannot list a campaign's leads: falling_sends, and a note saying why.
  const blind = await single(runout(28), {
    "leads.byCampaign": false,
  }).insights.campaignDiagnosis(DRAIN, { now: NOW });

  assert.deepEqual(codes(blind), ["falling_sends"]);
  assert.ok(
    blind.meta.notes.some((note) => note.startsWith("Lead runout:")),
    blind.meta.notes.join(" | ")
  );

  // Sends did not fall, so no lead is read: a cap of 1 lead would otherwise stop the read.
  const steady = await single({
    ...runout(1),
    stats: [
      row("drain", "2026-11-02", { contacted: 300, sent: 300 }),
      row("drain", "2026-11-09", { contacted: 300, sent: 300 }),
    ],
  }).insights.campaignDiagnosis({ ...DRAIN, max_leads: 1 }, { now: NOW });

  assert.deepEqual(codes(steady), []);
  assert.equal(steady.meta.complete, true);
});

const trackingFinding = async (settings: {
  trackClicks?: boolean;
  trackOpens?: boolean;
}) =>
  (
    await single({
      campaigns: [{ id: "tracking", name: "Tracking", settings }],
    }).insights.campaignDiagnosis({ campaign: "tracking" }, { now: NOW })
  ).data.findings.find((each) => each.code === "tracking_off")?.finding;

test("campaign_diagnosis says click tracking is off as well as open tracking", async () => {
  const run = trackingFinding;

  assert.equal(
    await run({ trackClicks: false, trackOpens: false }),
    "Open and click tracking are off, so missing open and click counts are expected and not a fault."
  );
  assert.equal(
    await run({ trackClicks: false, trackOpens: true }),
    "Click tracking is off, so no link click is counted; that is expected and not a fault."
  );
  assert.equal(
    await run({ trackClicks: true, trackOpens: false }),
    "Open tracking is off, so the missing open count is expected and not a fault."
  );
  assert.equal(await run({ trackClicks: true, trackOpens: true }), undefined);
});

// What is wrong with the sender at this position of the 143: #128 is
// disconnected and #140 has a warmup score of 0.
const fault = (position: number): Partial<MemorySender> => {
  if (position === 128) {
    return { status: "disconnected" };
  }

  return position === 140 ? { warmup: { enabled: true, score: 0 } } : {};
};

test("campaign_diagnosis screens every sender of the campaign, not the first 50, and flags a warmup score of 0", async () => {
  // 143 senders on the campaign, as in the live case; #128 is disconnected
  // and #140 has a warmup score of 0. 40 more senders belong to another campaign.
  const senders: MemorySender[] = Array.from({ length: 143 }, (_, index) => ({
    address: `s${index + 1}@send.example`,
    campaignIds: ["bigpool"],
    id: `s${index + 1}`,
    ...fault(index + 1),
  }));

  const other = Array.from({ length: 40 }, (_, index) => ({
    address: `o${index + 1}@send.example`,
    campaignIds: ["elsewhere"],
    id: `o${index + 1}`,
    status: "disconnected" as const,
  }));

  const data: MemoryData = {
    campaigns: [{ id: "bigpool", name: "Big pool" }],
    senders: [...other, ...senders],
  };

  const result = await single(data).insights.campaignDiagnosis(
    { campaign: "bigpool" },
    { now: NOW }
  );

  assert.deepEqual(
    result.data.findings.find((each) => each.code === "inactive_sender"),
    {
      code: "inactive_sender",
      finding:
        "2 of 143 senders are not fit to send: s128@send.example (disconnected), s140@send.example (warmup score 0).",
      next: "Reconnect or replace them; warmup_readiness shows which mailboxes are fit to send.",
      numbers: { inactive: 1, senders: 143, warmupZero: 1 },
      severity: "high",
    }
  );
  // Workspace size alone does not make the answer partial.
  assert.equal(result.meta.complete, true);
  assert.ok(
    !result.meta.notes.some((note) => note.includes("max_senders")),
    result.meta.notes.join(" | ")
  );
});
