import assert from "node:assert/strict";
import { test } from "node:test";

import type { MemoryData } from "../../src/memory/index.ts";
import { NOW, single } from "./helpers.ts";
import { pair, row, unsupported } from "./ops-helpers.ts";

const DATA: MemoryData = {
  campaigns: [
    { id: "a", name: "Alpha" },
    { id: "b", name: "Beta" },
    { id: "c", name: "Tiny", status: "paused" },
    { id: "d", name: "Mute", status: "completed" },
    { id: "e", name: "Silent" },
    { id: "f", name: "Draft", status: "draft" },
  ],
  stats: [
    row("a", "2026-10-01", { contacted: 500, replied: 5, sent: 500 }),
    row("a", "2026-11-01", {
      bounced: 10,
      contacted: 1000,
      positive: 30,
      replied: 150,
      sent: 1000,
    }),
    row("b", "2026-11-02", {
      bounced: 6,
      contacted: 60,
      positive: 6,
      replied: 12,
      sent: 60,
    }),
    row("c", "2026-11-02", { contacted: 10, replied: 2, sent: 10 }),
    // The vendor reports no replies and no positives here: unknown, not zero.
    row("d", "2026-11-03", { bounced: 4, contacted: 200, sent: 200 }),
    row("f", "2026-11-03", { contacted: 900, replied: 900, sent: 900 }),
  ],
};

const NOVEMBER = { from: "2026-11-01", to: "2026-11-30" };

test("campaign_ranking ranks by the low end of the interval, so a lucky small campaign does not win", async () => {
  const result = await single(DATA).insights.campaignRanking(NOVEMBER, {
    now: NOW,
  });

  assert.equal(result.insight, "campaign_ranking");
  assert.equal(result.data.metric, "reply_rate");
  assert.equal(result.data.better, "higher");
  assert.deepEqual(result.data.period, NOVEMBER);
  // Beta's raw rate is higher (20% against 15%), but 12 of 60 has a low end
  // of 11.83% and 150 of 1,000 has 12.92%.
  assert.deepEqual(result.data.ranked, [
    {
      campaign: "memory:agency:a",
      channel: "email",
      count: 150,
      high: 0.1735,
      low: 0.1292,
      campaignName: "Alpha",
      name: "Alpha",
      of: 1000,
      provider: "memory",
      rank: 1,
      rate: 0.15,
      sent: 1000,
      status: "active",
    },
    {
      campaign: "memory:agency:b",
      channel: "email",
      count: 12,
      high: 0.3178,
      low: 0.1183,
      campaignName: "Beta",
      name: "Beta",
      of: 60,
      provider: "memory",
      rank: 2,
      rate: 0.2,
      sent: 60,
      status: "active",
    },
  ]);
  assert.deepEqual(
    result.data.tooFewSends.map((each) => [each.name, each.sent, each.reason]),
    [["Tiny", 10, "10 sends, under the 50 needed to rank."]]
  );
  assert.deepEqual(
    result.data.unknown.map((each) => [each.name, each.sent, each.reason]),
    [
      ["Silent", null, "The vendor reports no sends for this period."],
      ["Mute", 200, "The vendor does not report the count behind this rate."],
    ]
  );
  // Top 0.15; median of 0.15 and 0.2 is 0.175.
  assert.deepEqual(result.data.gap, {
    difference: -0.025,
    median: 0.175,
    top: 0.15,
  });
  assert.equal(result.meta.complete, true);
});

test("campaign_ranking counts the whole history without a range, and min_sent decides who is ranked", async () => {
  const outbound = single(DATA);
  const whole = await outbound.insights.campaignRanking({});

  // Alpha over all time: 155 replies of 1,500 contacted is 10.33%, low end 8.89%.
  assert.deepEqual(
    whole.data.ranked.map((each) => [each.name, each.rate, each.low]),
    [
      ["Beta", 0.2, 0.1183],
      ["Alpha", 0.1033, 0.0889],
    ]
  );

  const loose = await outbound.insights.campaignRanking({
    ...NOVEMBER,
    min_sent: 5,
  });

  // 2 of 10 is 20% with a low end of 5.67%: ranked now, and last.
  assert.deepEqual(
    loose.data.ranked.map((each) => [each.rank, each.name, each.low]),
    [
      [1, "Alpha", 0.1292],
      [2, "Beta", 0.1183],
      [3, "Tiny", 0.0567],
    ]
  );
  assert.deepEqual(loose.data.tooFewSends, []);
  // Rates 0.15, 0.2, 0.2: the median is 0.2.
  assert.deepEqual(loose.data.gap, {
    difference: -0.05,
    median: 0.2,
    top: 0.15,
  });
});

test("campaign_ranking ranks bounce rate lowest first by the high end, and positive replies by the low end", async () => {
  const outbound = single(DATA);

  const bounce = await outbound.insights.campaignRanking({
    ...NOVEMBER,
    metric: "bounce_rate",
  });

  assert.equal(bounce.data.better, "lower");
  // 10 of 1,000, 4 of 200, 6 of 60.
  assert.deepEqual(
    bounce.data.ranked.map((each) => [
      each.name,
      each.count,
      each.of,
      each.rate,
      each.high,
    ]),
    [
      ["Alpha", 10, 1000, 0.01, 0.0183],
      ["Mute", 4, 200, 0.02, 0.0503],
      ["Beta", 6, 60, 0.1, 0.2015],
    ]
  );

  const positive = await outbound.insights.campaignRanking({
    ...NOVEMBER,
    metric: "positive_reply_rate",
  });

  // 6 of 60 has a low end of 4.66%, above 30 of 1,000 at 2.11%.
  assert.deepEqual(
    positive.data.ranked.map((each) => [each.name, each.rate, each.low]),
    [
      ["Beta", 0.1, 0.0466],
      ["Alpha", 0.03, 0.0211],
    ]
  );
  assert.deepEqual(
    positive.data.unknown.map((each) => each.name),
    ["Silent", "Mute"]
  );
});

test("campaign_ranking reads only the asked statuses, with or without a vendor filter", async () => {
  const drafts = await single(DATA).insights.campaignRanking({
    statuses: ["draft"],
  });

  assert.deepEqual(
    drafts.data.ranked.map((each) => [each.name, each.status, each.rate]),
    [["Draft", "draft", 1]]
  );

  const unfiltered = await single(DATA, {
    "campaigns.status": false,
  }).insights.campaignRanking(NOVEMBER);

  assert.deepEqual(
    unfiltered.data.ranked.map((each) => each.name),
    ["Alpha", "Beta"]
  );
  assert.deepEqual(
    unfiltered.data.tooFewSends.map((each) => each.name),
    ["Tiny"]
  );
});

test("campaign_ranking answers with nothing to rank, says when the cap cut the list, and needs campaign stats", async () => {
  const empty = await single({}).insights.campaignRanking({});

  assert.deepEqual(empty.data.ranked, []);
  assert.deepEqual(empty.data.tooFewSends, []);
  assert.deepEqual(empty.data.unknown, []);
  assert.deepEqual(empty.data.gap, {
    difference: null,
    median: null,
    top: null,
  });
  assert.equal(empty.meta.complete, true);

  const capped = await single(DATA).insights.campaignRanking({
    ...NOVEMBER,
    max_campaigns: 1,
  });

  assert.deepEqual(
    capped.data.ranked.map((each) => each.name),
    ["Alpha"]
  );
  assert.equal(capped.meta.complete, false);

  await assert.rejects(
    async () =>
      await single(DATA, { "stats.campaign": false }).insights.campaignRanking(
        {}
      ),
    unsupported("stats.campaign")
  );
});

test("campaign_ranking ranks campaigns of two tools together", async () => {
  const result = await pair(DATA, {
    campaigns: [{ channel: "linkedin", id: "k1", name: "Kappa" }],
    stats: [
      row("k1", "2026-11-05", { contacted: 400, replied: 100, sent: 400 }),
    ],
  }).insights.campaignRanking(NOVEMBER);

  assert.deepEqual(
    result.data.ranked.map((each) => [
      each.rank,
      each.campaign,
      each.channel,
      each.provider,
      each.rate,
    ]),
    [
      [1, "lntool:agency:k1", "linkedin", "lntool", 0.25],
      [2, "mailtool:agency:a", "email", "mailtool", 0.15],
      [3, "mailtool:agency:b", "email", "mailtool", 0.2],
    ]
  );
  assert.equal(result.meta.provider, "combined");
});
