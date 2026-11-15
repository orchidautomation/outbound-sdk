import assert from "node:assert/strict";
import { test } from "node:test";

import type { MemoryData } from "../../src/memory/index.ts";
import { NOW, single } from "./helpers.ts";
import { pair, row, unsupported } from "./ops-helpers.ts";

// NOW is 2026-11-14, so the last 7 complete days are 11-07 to 11-13 and the
// 7 before are 10-31 to 11-06.
const DATA: MemoryData = {
  campaigns: [
    { id: "c1", name: "Rising" },
    { id: "c2", name: "Flat" },
    { id: "c3", name: "New", status: "paused" },
    { id: "c4", name: "Archived", status: "archived" },
  ],
  stats: [
    row("c1", "2026-10-20", { contacted: 999, replied: 999, sent: 999 }),
    row("c1", "2026-11-01", {
      bounced: 10,
      contacted: 500,
      replied: 30,
      sent: 500,
    }),
    row("c1", "2026-11-08", { contacted: 200, replied: 20, sent: 200 }),
    row("c1", "2026-11-12", {
      bounced: 5,
      contacted: 300,
      replied: 40,
      sent: 300,
    }),
    // Today is not over, so it is in neither period.
    row("c1", "2026-11-14", { contacted: 77, replied: 77, sent: 77 }),
    row("c2", "2026-11-03", { contacted: 400, replied: 18, sent: 400 }),
    row("c2", "2026-11-10", { contacted: 400, replied: 20, sent: 400 }),
    row("c3", "2026-11-09", { contacted: 100, replied: 5, sent: 100 }),
    row("c4", "2026-11-09", { contacted: 800, replied: 8, sent: 800 }),
  ],
};

// New has no row at all in the earlier period, so it is not counted there.
const BOUNCE_NOTE =
  "Every campaign added together: this period's bounce rate (1 of 3), the earlier period's bounce rate (1 of 2) count only the campaigns that report both the count and what it is divided by. The others are left out of the rate, not counted as 0.";

const CURRENT = { from: "2026-11-07", to: "2026-11-13" };
const PREVIOUS = { from: "2026-10-31", to: "2026-11-06" };

test("period_comparison sets the last days against the days before, per campaign and in total", async () => {
  const result = await single(DATA).insights.periodComparison({}, { now: NOW });

  assert.equal(result.insight, "period_comparison");
  assert.equal(result.data.days, 7);
  assert.deepEqual(result.data.current, CURRENT);
  assert.deepEqual(result.data.previous, PREVIOUS);
  // Rising moved 6 points, Flat half a point: largest change first.
  assert.deepEqual(
    result.data.campaigns.map((each) => each.name),
    ["Rising", "Flat"]
  );

  const [rising, flat] = result.data.campaigns;

  assert.deepEqual(rising, {
    campaign: "memory:agency:c1",
    // 500 sends both periods; 60 replies against 30; 5 bounces against 10.
    change: {
      bounceRate: -0.01,
      bounced: -5,
      contacted: 0,
      positive: null,
      positiveRate: null,
      replied: 30,
      replyRate: 0.06,
      sent: 0,
    },
    channel: "email",
    current: {
      bounceRate: 0.01,
      bounced: 5,
      contacted: 500,
      positive: null,
      positiveRate: null,
      replied: 60,
      replyRate: 0.12,
      sent: 500,
    },
    finding:
      "Replies per message sent went from 6% to 12%; more than chance (p = 0.0009).",
    campaignName: "Rising",
    name: "Rising",
    previous: {
      bounceRate: 0.02,
      bounced: 10,
      contacted: 500,
      positive: null,
      positiveRate: null,
      replied: 30,
      replyRate: 0.06,
      sent: 500,
    },
    provider: "memory",
    replyRateBasis: "sent",
    // Pooled 90 of 1,000 = 0.09; error = sqrt(0.09 x 0.91 x 2/500) = 0.0181;
    // z = 0.06 / 0.0181 = 3.31.
    replyRateTest: { pValue: 0.0009, significant: true, z: 3.315 },
    status: "active",
    verdict: "up",
  });
  // 20 of 400 against 18 of 400: z = 0.33, well within chance.
  assert.deepEqual(
    [
      flat?.current.replyRate,
      flat?.previous.replyRate,
      flat?.change.replyRate,
      flat?.change.bounced,
      flat?.verdict,
      flat?.replyRateTest?.significant,
    ],
    [0.05, 0.045, 0.005, null, "no_real_change", false]
  );
  assert.match(
    flat?.finding ?? "",
    /^Replies per message sent went from 4\.5% to 5%; within what chance would give/u
  );
  // New has no sends in the earlier period: unknown, not zero.
  assert.deepEqual(result.data.tooFewSends, [
    {
      campaign: "memory:agency:c3",
      channel: "email",
      currentSent: 100,
      campaignName: "New",
      name: "New",
      previousSent: null,
      provider: "memory",
      status: "paused",
    },
  ]);
  // Current: 500 + 400 + 100 sends and 60 + 20 + 5 replies. Previous: 500 + 400 and 30 + 18.
  assert.deepEqual(
    [
      result.data.total.current.sent,
      result.data.total.current.replied,
      result.data.total.current.replyRate,
      result.data.total.previous.sent,
      result.data.total.previous.replied,
      result.data.total.previous.replyRate,
      result.data.total.change.replyRate,
      result.data.total.verdict,
    ],
    [1000, 85, 0.085, 900, 48, 0.0533, 0.0317, "up"]
  );
  // The vendor's workspace totals also hold the archived campaign's 800 sends and 8 replies.
  assert.deepEqual(
    [
      result.data.workspace?.current.sent,
      result.data.workspace?.current.replied,
      result.data.workspace?.current.replyRate,
      result.data.workspace?.previous.sent,
      result.data.workspace?.verdict,
    ],
    [1800, 93, 0.0517, 900, "no_real_change"]
  );
  assert.equal(result.meta.complete, true);
  // Only Rising reports bounces. Its 5 and 10 are divided by its own 500
  // sends, not by every campaign's 1,000 and 900.
  assert.deepEqual(
    [
      result.data.total.current.bounced,
      result.data.total.current.bounceRate,
      result.data.total.previous.bounced,
      result.data.total.previous.bounceRate,
      result.data.total.change.bounceRate,
    ],
    [5, 0.01, 10, 0.02, -0.01]
  );
  assert.deepEqual(result.meta.notes, [BOUNCE_NOTE]);
});

test("period_comparison follows days, min_sent, alpha and the statuses", async () => {
  const outbound = single(DATA);

  // One day: 11-13 against 11-12. Only c1 sent on 11-12, and nothing on 11-13.
  const day = await outbound.insights.periodComparison(
    { days: 1, min_sent: 0 },
    { now: NOW }
  );

  assert.deepEqual(day.data.current, { from: "2026-11-13", to: "2026-11-13" });
  assert.deepEqual(day.data.previous, { from: "2026-11-12", to: "2026-11-12" });
  assert.deepEqual(day.data.campaigns, []);
  assert.deepEqual(
    day.data.tooFewSends.map((each) => [
      each.name,
      each.currentSent,
      each.previousSent,
    ]),
    [
      ["Rising", null, 300],
      ["Flat", null, null],
      ["New", null, null],
    ]
  );

  const strict = await outbound.insights.periodComparison(
    { min_sent: 450 },
    { now: NOW }
  );

  assert.deepEqual(
    strict.data.campaigns.map((each) => each.name),
    ["Rising"]
  );
  assert.deepEqual(
    strict.data.tooFewSends.map((each) => each.name),
    ["Flat", "New"]
  );

  const doubtful = await outbound.insights.periodComparison(
    { alpha: 0.0001 },
    { now: NOW }
  );

  assert.equal(doubtful.data.campaigns[0]?.verdict, "no_real_change");
  assert.equal(doubtful.data.campaigns[0]?.replyRateTest?.pValue, 0.0009);

  const archived = await outbound.insights.periodComparison(
    { min_sent: 0, statuses: ["archived"] },
    { now: NOW }
  );

  assert.deepEqual(
    archived.data.tooFewSends.map((each) => [each.name, each.currentSent]),
    [["Archived", 800]]
  );
});

test("period_comparison reports a fall, and an unknown when a period has no counts", async () => {
  const result = await single({
    campaigns: [
      { id: "f", name: "Falling" },
      { id: "u", name: "Unknown" },
    ],
    stats: [
      row("f", "2026-11-02", { contacted: 500, replied: 60, sent: 500 }),
      row("f", "2026-11-09", { contacted: 500, replied: 30, sent: 500 }),
      // Sends without a reply count in either period.
      row("u", "2026-11-02", { sent: 300 }),
      row("u", "2026-11-09", { sent: 300 }),
    ],
  }).insights.periodComparison({}, { now: NOW });

  const [falling, unknown] = result.data.campaigns;

  assert.deepEqual(
    [falling?.verdict, falling?.change.replyRate, falling?.replyRateTest?.z],
    ["down", -0.06, -3.315]
  );
  assert.deepEqual(
    [
      unknown?.name,
      unknown?.verdict,
      unknown?.change.replyRate,
      unknown?.current.replied,
      unknown?.replyRateTest,
    ],
    ["Unknown", "unknown", null, null, null]
  );
  assert.match(unknown?.finding ?? "", /cannot be compared/u);
});

test("period_comparison has nothing to compare without campaigns, and says when the cap cut the list", async () => {
  const empty = await single({}).insights.periodComparison({}, { now: NOW });

  assert.deepEqual(empty.data.campaigns, []);
  assert.deepEqual(empty.data.tooFewSends, []);
  assert.equal(empty.data.total.current.sent, null);
  assert.equal(empty.data.total.verdict, "unknown");
  assert.equal(empty.data.workspace?.current.sent, null);

  const capped = await single(DATA).insights.periodComparison(
    { max_campaigns: 1 },
    { now: NOW }
  );

  assert.deepEqual(
    capped.data.campaigns.map((each) => each.name),
    ["Rising"]
  );
  assert.equal(capped.meta.complete, false);
});

test("period_comparison leaves workspace totals out when the adapter has none, and needs campaign stats", async () => {
  const result = await single(DATA, {
    "stats.workspace": false,
  }).insights.periodComparison({}, { now: NOW });

  assert.equal(result.data.workspace, null);
  assert.equal(result.data.total.current.sent, 1000);
  assert.deepEqual(result.meta.notes, [
    BOUNCE_NOTE,
    "Workspace totals were left out: the adapter has no workspace stats. `total` adds up the campaigns read.",
  ]);

  await assert.rejects(
    async () =>
      await single(DATA, {
        "stats.campaign": false,
      }).insights.periodComparison({}),
    unsupported("stats.campaign")
  );
});

test("period_comparison compares campaigns of two tools and adds their workspaces together", async () => {
  const result = await pair(DATA, {
    campaigns: [{ channel: "linkedin", id: "k1", name: "Seats" }],
    stats: [
      row("k1", "2026-11-02", { contacted: 200, replied: 10, sent: 200 }),
      row("k1", "2026-11-11", { contacted: 200, replied: 30, sent: 200 }),
    ],
  }).insights.periodComparison({}, { now: NOW });

  // Seats went from 5% to 15%, the largest move.
  assert.deepEqual(
    result.data.campaigns.map((each) => [
      each.campaign,
      each.provider,
      each.change.replyRate,
    ]),
    [
      ["lntool:agency:k1", "lntool", 0.1],
      ["mailtool:agency:c1", "mailtool", 0.06],
      ["mailtool:agency:c2", "mailtool", 0.005],
    ]
  );
  // Email 1,000 sends and 85 replies plus LinkedIn 200 and 30.
  assert.deepEqual(
    [result.data.total.current.sent, result.data.total.current.replied],
    [1200, 115]
  );
  // Both workspaces, the archived email campaign included: 1,800 + 200.
  assert.equal(result.data.workspace?.current.sent, 2000);
  assert.equal(result.meta.provider, "combined");
});

test("period_comparison divides a period's replies by messages sent, so a rate never passes 100%", async () => {
  // A week that sent 300 messages to 5 new leads: replies to follow-ups come
  // from leads contacted before the period, so leads contacted is no base.
  const result = await single({
    campaigns: [{ id: "w", name: "Follow-ups" }],
    stats: [
      row("w", "2026-11-02", { contacted: 5, replied: 6, sent: 300 }),
      row("w", "2026-11-09", {
        contacted: 5,
        positive: 4,
        replied: 8,
        sent: 300,
      }),
    ],
  }).insights.periodComparison({}, { now: NOW });

  const [weekly] = result.data.campaigns;

  assert.deepEqual(
    [
      weekly?.replyRateBasis,
      weekly?.current.replyRate,
      weekly?.current.positiveRate,
      weekly?.previous.replyRate,
      result.data.total.replyRateBasis,
      result.data.total.current.replyRate,
      result.data.workspace?.current.replyRate,
    ],
    ["sent", 0.0267, 0.0133, 0.02, "sent", 0.0267, 0.0267]
  );
  assert.ok((weekly?.current.replyRate ?? 2) <= 1);
  assert.match(
    weekly?.finding ?? "",
    /^Replies per message sent went from 2% to 2\.7%; /u
  );
});

test("period_comparison falls back to leads contacted for both periods when a period does not report messages sent", async () => {
  // A vendor that counts leads contacted but not messages: 2 of 100 before,
  // 8 of 50 now. The current week reports sends, the earlier one does not, so
  // both periods are divided by leads contacted rather than mixing bases.
  const result = await single({
    campaigns: [{ id: "k", name: "Seats" }],
    stats: [
      row("k", "2026-11-02", { contacted: 100, replied: 2 }),
      row("k", "2026-11-09", { contacted: 50, replied: 8, sent: 200 }),
    ],
  }).insights.periodComparison({}, { now: NOW });

  const [seats] = result.data.campaigns;

  assert.deepEqual(
    [
      seats?.replyRateBasis,
      seats?.previous.replyRate,
      seats?.current.replyRate,
      result.data.total.replyRateBasis,
      result.data.total.current.replyRate,
    ],
    ["contacted", 0.02, 0.16, "contacted", 0.16]
  );
  assert.notEqual(seats?.verdict, "unknown");
  assert.match(
    seats?.finding ?? "",
    /^Replies per lead contacted went from 2% to 16%; /u
  );
});
