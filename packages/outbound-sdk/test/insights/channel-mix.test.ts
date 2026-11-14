import assert from "node:assert/strict";
import { test } from "node:test";

import type { MemoryData } from "../../src/memory/index.ts";
import { NOW, single } from "./helpers.ts";
import { pair, row, unsupported } from "./ops-helpers.ts";

const MAIL: MemoryData = {
  campaigns: [
    { id: "m1", name: "Mail one" },
    { id: "m2", name: "Mail two", status: "paused" },
    { id: "m3", name: "Mail draft", status: "draft" },
  ],
  stats: [
    row("m1", "2026-11-03", {
      bounced: 20,
      contacted: 800,
      positive: 10,
      replied: 50,
      sent: 1000,
    }),
    row("m2", "2026-11-04", {
      contacted: 200,
      positive: 2,
      replied: 10,
      sent: 500,
    }),
    row("m2", "2026-09-01", { contacted: 77, replied: 7, sent: 70 }),
    row("m3", "2026-11-04", { contacted: 999, replied: 999, sent: 999 }),
  ],
};

const LINKEDIN: MemoryData = {
  campaigns: [{ channel: "linkedin", id: "k1", name: "Seats" }],
  stats: [
    row("k1", "2026-11-05", {
      connectionsAccepted: 100,
      connectionsSent: 250,
      contacted: 200,
      positive: 9,
      replied: 20,
      sent: 300,
    }),
  ],
};

const NOVEMBER = { from: "2026-11-01", to: "2026-11-30" };

test("channel_mix adds campaigns up per channel and tests the difference in reply rate", async () => {
  const result = await pair(MAIL, LINKEDIN).insights.channelMix(NOVEMBER, {
    now: NOW,
  });

  assert.equal(result.insight, "channel_mix");
  assert.deepEqual(result.data.period, NOVEMBER);
  assert.deepEqual(result.data.channels, [
    {
      acceptance: null,
      // Only m1 reports bounces; m2's unknown count is not read as zero.
      bounced: 20,
      campaigns: 2,
      channel: "email",
      contacted: 1000,
      positive: 12,
      positiveRate: {
        count: 12,
        high: 0.0209,
        low: 0.0069,
        of: 1000,
        rate: 0.012,
      },
      replied: 60,
      // 60 replies of 1,000 leads contacted, not of 1,500 messages.
      replyRate: { count: 60, high: 0.0765, low: 0.0469, of: 1000, rate: 0.06 },
      sent: 1500,
    },
    {
      // 100 accepted of 250 requests.
      acceptance: {
        count: 100,
        high: 0.4618,
        low: 0.3412,
        of: 250,
        rate: 0.4,
      },
      bounced: null,
      campaigns: 1,
      channel: "linkedin",
      contacted: 200,
      positive: 9,
      positiveRate: {
        count: 9,
        high: 0.0833,
        low: 0.0239,
        of: 200,
        rate: 0.045,
      },
      replied: 20,
      replyRate: { count: 20, high: 0.1494, low: 0.0657, of: 200, rate: 0.1 },
      sent: 300,
    },
  ]);
  // Pooled 80 of 1,200 = 0.0667; error = sqrt(0.0667 x 0.9333 x (1/1000 + 1/200))
  // = 0.01932; z = (0.06 - 0.1) / 0.01932 = -2.07; two-sided p = 0.0384.
  assert.deepEqual(result.data.comparison, {
    difference: 0.04,
    higher: "linkedin",
    test: { pValue: 0.0384, significant: true, z: -2.0702 },
  });
  assert.equal(
    result.data.finding,
    "The reply rate is 10% on LinkedIn against 6% on email; the difference is more than chance (p = 0.0384)."
  );
  assert.deepEqual(
    result.data.byProvider.map((each) => [
      each.provider,
      each.channel,
      each.campaigns,
      each.sent,
      each.replyRate.rate,
    ]),
    [
      ["lntool", "linkedin", 1, 300, 0.1],
      ["mailtool", "email", 2, 1500, 0.06],
    ]
  );
  assert.equal(result.meta.complete, true);
  assert.equal(result.meta.provider, "combined");
});

test("channel_mix holds the difference to the alpha it is given, and counts the whole history without a range", async () => {
  const outbound = pair(MAIL, LINKEDIN);

  const strict = await outbound.insights.channelMix({
    ...NOVEMBER,
    alpha: 0.01,
  });

  assert.equal(strict.data.comparison?.test.significant, false);
  assert.equal(
    strict.data.finding,
    "The reply rate is 10% on LinkedIn against 6% on email; the difference could be chance (p = 0.0384)."
  );

  const whole = await outbound.insights.channelMix({});
  const [email] = whole.data.channels;

  // m2's September row adds 70 sends, 77 contacted and 7 replies.
  assert.deepEqual(
    [email?.sent, email?.contacted, email?.replied, email?.replyRate.rate],
    [1570, 1077, 67, 0.0622]
  );

  const drafts = await outbound.insights.channelMix({ statuses: ["draft"] });

  assert.deepEqual(
    drafts.data.channels.map((each) => [each.channel, each.sent]),
    [["email", 999]]
  );
});

test("channel_mix says there is nothing to compare with one channel, with none, or without counts", async () => {
  const one = await single(MAIL).insights.channelMix(NOVEMBER);

  assert.deepEqual(
    one.data.channels.map((each) => each.channel),
    ["email"]
  );
  assert.equal(one.data.comparison, null);
  assert.equal(
    one.data.finding,
    "Only email campaigns were found, so there is nothing to compare."
  );

  const none = await single({}).insights.channelMix({});

  assert.deepEqual(none.data.channels, []);
  assert.deepEqual(none.data.byProvider, []);
  assert.equal(
    none.data.finding,
    "No campaigns were found, so there is nothing to compare."
  );

  const dark = await pair(MAIL, {
    campaigns: [{ channel: "linkedin", id: "k9" }],
    stats: [row("k9", "2026-11-05", { contacted: 40, sent: 40 })],
  }).insights.channelMix(NOVEMBER);

  const [, linkedin] = dark.data.channels;
  assert.equal(linkedin?.replied, null);
  assert.equal(linkedin?.replyRate.rate, null);
  assert.equal(linkedin?.acceptance?.rate, null);
  assert.equal(dark.data.comparison, null);
  assert.match(dark.data.finding, /cannot be compared/u);

  // LinkedIn ahead of email is reported with email named second, and the reverse.
  const reversed = await pair(MAIL, {
    campaigns: [{ channel: "linkedin", id: "k8" }],
    stats: [row("k8", "2026-11-05", { contacted: 500, replied: 5, sent: 500 })],
  }).insights.channelMix(NOVEMBER);

  assert.equal(reversed.data.comparison?.higher, "email");
  assert.equal(reversed.data.comparison?.difference, 0.05);
  assert.match(
    reversed.data.finding,
    /^The reply rate is 6% on email against 1% on LinkedIn/u
  );
});

test("channel_mix says when the cap cut the list, and needs campaign stats", async () => {
  const capped = await pair(MAIL, LINKEDIN).insights.channelMix({
    ...NOVEMBER,
    max_campaigns: 1,
  });

  assert.equal(capped.data.channels.length, 1);
  assert.equal(capped.meta.complete, false);

  await assert.rejects(
    async () =>
      await single(MAIL, { "stats.campaign": false }).insights.channelMix({}),
    unsupported("stats.campaign")
  );
});

test("channel_mix divides replies only by the leads of the campaigns that report replies, and says so", async () => {
  const result = await pair(
    {
      campaigns: [
        { id: "m1", name: "Reports replies" },
        { id: "m2", name: "Sends only" },
      ],
      stats: [
        row("m1", "2026-11-03", {
          contacted: 500,
          positive: 5,
          replied: 50,
          sent: 500,
        }),
        row("m2", "2026-11-04", { contacted: 1500, sent: 1500 }),
      ],
    },
    {
      campaigns: [
        { channel: "linkedin", id: "k1" },
        { channel: "linkedin", id: "k2" },
      ],
      stats: [
        row("k1", "2026-11-05", {
          connectionsAccepted: 40,
          connectionsSent: 100,
          contacted: 100,
          replied: 20,
          sent: 100,
        }),
        // Connection requests are not reported for this one.
        row("k2", "2026-11-05", { contacted: 100, replied: 20, sent: 100 }),
      ],
    }
  ).insights.channelMix(NOVEMBER, { now: NOW });

  const [email, linkedin] = result.data.channels;

  // 50 replies of the 500 leads of the campaign that reports replies: 10%,
  // not 50 of 2,000 (2.5%). The counts beside it are still both campaigns'.
  assert.deepEqual(
    [
      email?.contacted,
      email?.replied,
      email?.replyRate.of,
      email?.replyRate.rate,
    ],
    [2000, 50, 500, 0.1]
  );
  assert.deepEqual(
    [
      email?.positiveRate.count,
      email?.positiveRate.of,
      email?.positiveRate.rate,
    ],
    [5, 500, 0.01]
  );
  // 40 accepted of the 100 requests that campaign sent.
  assert.deepEqual(
    [
      linkedin?.acceptance?.count,
      linkedin?.acceptance?.of,
      linkedin?.replyRate.rate,
    ],
    [40, 100, 0.2]
  );
  // 10% against 20%: the comparison uses the same rates.
  assert.equal(result.data.comparison?.higher, "linkedin");
  assert.equal(result.data.comparison?.difference, 0.1);
  assert.deepEqual(result.meta.notes, [
    "Channel email: reply rate (1 of 2), positive reply rate (1 of 2) count only the campaigns that report both the count and what it is divided by. The others are left out of the rate, not counted as 0.",
    "mailtool email: reply rate (1 of 2), positive reply rate (1 of 2) count only the campaigns that report both the count and what it is divided by. The others are left out of the rate, not counted as 0.",
  ]);
});

test("a finding prints a p-value too small to round as p < 0.0001, never as p = 0", async () => {
  const result = await pair(
    {
      campaigns: [{ id: "m1" }],
      stats: [
        row("m1", "2026-11-03", { contacted: 5000, replied: 50, sent: 5000 }),
      ],
    },
    {
      campaigns: [{ channel: "linkedin", id: "k1" }],
      stats: [
        row("k1", "2026-11-05", { contacted: 5000, replied: 1000, sent: 5000 }),
      ],
    }
  ).insights.channelMix(NOVEMBER, { now: NOW });

  assert.equal(result.data.comparison?.test.pValue, 0);
  assert.equal(
    result.data.finding,
    "The reply rate is 20% on LinkedIn against 1% on email; the difference is more than chance (p < 0.0001)."
  );

  const periods = await single({
    campaigns: [{ id: "c1" }],
    stats: [
      row("c1", "2026-11-03", { contacted: 5000, replied: 50, sent: 5000 }),
      row("c1", "2026-11-10", { contacted: 5000, replied: 1000, sent: 5000 }),
    ],
  }).insights.periodComparison({}, { now: NOW });

  assert.equal(
    periods.data.total.finding,
    "Reply rate went from 1% to 20%; more than chance (p < 0.0001)."
  );
});
