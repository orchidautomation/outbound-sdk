import assert from "node:assert/strict";
import { test } from "node:test";

import type { MemoryData } from "../../src/memory/index.ts";
import { NOW, single } from "./helpers.ts";
import { pair, ref, refused } from "./senders-helpers.ts";

const row = (
  campaignId: string,
  counts: { bounced?: number; sent?: number },
  extra: { date?: string; senderId?: string } = {}
) => ({ campaignId, counts, date: "2026-11-10", ...extra });

const DATA: MemoryData = {
  campaigns: [
    { id: "c3", name: "Fine" },
    { id: "c2", name: "Warm", status: "paused" },
    { id: "c1", name: "Hot" },
    { id: "c4", name: "Small" },
    { id: "c5", name: "No bounce count" },
    { id: "c6", name: "No stats" },
    { id: "c7", name: "No sent count" },
    { id: "c8", name: "Nothing sent" },
  ],
  senders: [
    { address: "s3@example.com", campaignIds: ["c1"], id: "s3" },
    { address: "s2@example.com", campaignIds: ["c1", "c2"], id: "s2" },
    { address: "s1@example.com", campaignIds: ["c1"], id: "s1", name: "One" },
    { address: "s4@example.com", campaignIds: ["c2"], id: "s4" },
  ],
  stats: [
    // Hot: 600 + 400 sent, 20 + 60 bounced.
    row("c1", { bounced: 20, sent: 600 }, { date: "2026-11-01" }),
    row("c1", { bounced: 60, sent: 400 }),
    row("c2", { bounced: 20, sent: 400 }),
    row("c3", { bounced: 10, sent: 500 }),
    row("c4", { bounced: 10, sent: 40 }),
    row("c5", { sent: 300 }),
    row("c7", { bounced: 3 }),
    row("c8", { bounced: 0, sent: 0 }),
    row("c1", { bounced: 60, sent: 600 }, { senderId: "s1" }),
    row("c1", { bounced: 12, sent: 300 }, { senderId: "s2" }),
    row("c2", { bounced: 8, sent: 200 }, { senderId: "s2" }),
    row("c1", { bounced: 3, sent: 300 }, { senderId: "s3" }),
  ],
};

test("bounce_watch lists the campaigns over the threshold worst first, with their senders", async () => {
  const result = await single(DATA).insights.bounceWatch({}, { now: NOW });
  const { data } = result;

  assert.equal(result.insight, "bounce_watch");
  assert.deepEqual(data.over, [
    {
      bounced: 80,
      campaign: ref("c1"),
      finding: "80 of 1000 sends bounced (0.08), over the 0.03 threshold.",
      interval: { high: 0.0985, low: 0.0647 },
      name: "Hot",
      rate: 0.08,
      senders: [
        {
          address: "s1@example.com",
          bounced: 60,
          interval: { high: 0.1266, low: 0.0785 },
          name: "One",
          rate: 0.1,
          sender: ref("s1"),
          sent: 600,
        },
        // Counted over both of its campaigns: 12 + 8 of 300 + 200.
        {
          address: "s2@example.com",
          bounced: 20,
          interval: { high: 0.061, low: 0.026 },
          name: null,
          rate: 0.04,
          sender: ref("s2"),
          sent: 500,
        },
      ],
      sent: 1000,
      status: "active",
    },
    {
      bounced: 20,
      campaign: ref("c2"),
      finding: "20 of 400 sends bounced (0.05), over the 0.03 threshold.",
      interval: { high: 0.076, low: 0.0326 },
      name: "Warm",
      rate: 0.05,
      // s4 has no stats, so it is not named.
      senders: [
        {
          address: "s2@example.com",
          bounced: 20,
          interval: { high: 0.061, low: 0.026 },
          name: null,
          rate: 0.04,
          sender: ref("s2"),
          sent: 500,
        },
      ],
      sent: 400,
      status: "paused",
    },
  ]);
  assert.deepEqual(data.totals, {
    // 80 + 20 + 10 + 10 + 0 bounced of 1000 + 400 + 500 + 40 + 0 sent.
    bounced: 120,
    campaigns: 8,
    clean: 1,
    over: 2,
    rate: 0.0619,
    sent: 1940,
    tooFewSends: 2,
    unknown: 3,
  });
  assert.equal(data.threshold, 0.03);
  assert.equal(data.minSent, 100);
  assert.equal(result.meta.complete, true);
});

test("bounce_watch sets small campaigns apart and never calls an unknown count clean", async () => {
  const { data } = await single(DATA).insights.bounceWatch({});

  assert.deepEqual(data.tooFewSends, [
    {
      bounced: 10,
      campaign: ref("c4"),
      finding: "10 of 40 sends bounced; under 100 sends is too few to judge.",
      interval: { high: 0.4019, low: 0.1419 },
      name: "Small",
      rate: 0.25,
      senders: null,
      sent: 40,
      status: "active",
    },
    {
      bounced: 0,
      campaign: ref("c8"),
      finding: "0 of 0 sends bounced; under 100 sends is too few to judge.",
      interval: null,
      name: "Nothing sent",
      rate: null,
      senders: null,
      sent: 0,
      status: "active",
    },
  ]);
  assert.deepEqual(data.unknown, [
    {
      campaign: ref("c5"),
      name: "No bounce count",
      reason: "The vendor does not report a bounce count.",
      status: "active",
    },
    {
      campaign: ref("c6"),
      name: "No stats",
      reason: "The vendor returned no stats for the period.",
      status: "active",
    },
    {
      campaign: ref("c7"),
      name: "No sent count",
      reason: "The vendor does not report a sent count.",
      status: "active",
    },
  ]);
});

test("bounce_watch moves campaigns and senders with the threshold and with min_sent", async () => {
  const strict = await single(DATA).insights.bounceWatch({ threshold: 0.06 });

  assert.deepEqual(
    strict.data.over.map((campaign) => campaign.name),
    ["Hot"]
  );
  assert.deepEqual(
    strict.data.over[0]?.senders?.map((sender) => sender.sender),
    [ref("s1")]
  );
  assert.equal(strict.data.totals.clean, 2);

  const loose = await single(DATA).insights.bounceWatch({ threshold: 0.01 });

  assert.deepEqual(
    loose.data.over.map((campaign) => campaign.name),
    ["Hot", "Warm", "Fine"]
  );
  assert.equal(loose.data.totals.clean, 0);

  const small = await single(DATA).insights.bounceWatch({ min_sent: 30 });

  assert.deepEqual(
    small.data.over.map((campaign) => [campaign.name, campaign.rate]),
    [
      ["Small", 0.25],
      ["Hot", 0.08],
      ["Warm", 0.05],
    ]
  );

  // With no minimum, a campaign that sent nothing still cannot be judged.
  const none = await single(DATA).insights.bounceWatch({ min_sent: 0 });

  assert.deepEqual(
    none.data.tooFewSends.map((campaign) => campaign.name),
    ["Nothing sent"]
  );
});

test("bounce_watch counts only the days asked for", async () => {
  const late = await single(DATA).insights.bounceWatch({ from: "2026-11-05" });
  const [hot] = late.data.over;

  assert.equal(hot?.sent, 400);
  assert.equal(hot?.bounced, 60);
  assert.equal(hot?.rate, 0.15);
  assert.deepEqual(hot?.interval, { high: 0.1883, low: 0.1183 });

  const early = await single(DATA).insights.bounceWatch({ to: "2026-11-05" });

  assert.deepEqual(
    early.data.over.map((campaign) => [
      campaign.name,
      campaign.sent,
      campaign.bounced,
      campaign.rate,
      campaign.senders,
    ]),
    // 20 of 600; no sender has stats that early.
    [["Hot", 600, 20, 0.0333, []]]
  );
  assert.equal(early.data.totals.unknown, 7);
});

test("bounce_watch leaves the senders out when asked to, or when the adapter cannot read them", async () => {
  const skipped = await single(DATA).insights.bounceWatch({
    include_senders: false,
  });

  assert.equal(skipped.data.over[0]?.senders, null);
  assert.deepEqual(skipped.meta.notes, []);

  const note =
    "Senders were not checked: the adapter needs stats per sender and the list of a campaign's senders.";

  const noStats = await single(DATA, {
    "stats.bySender": false,
  }).insights.bounceWatch({});

  assert.equal(noStats.data.over[0]?.senders, null);
  assert.equal(noStats.data.over.length, 2);
  assert.deepEqual(noStats.meta.notes, [note]);

  const noList = await single(DATA, {
    "senders.byCampaign": false,
  }).insights.bounceWatch({});

  assert.equal(noList.data.over[1]?.senders, null);
  assert.deepEqual(noList.meta.notes, [note]);
});

test("bounce_watch has nothing to report with no campaigns", async () => {
  const result = await single(
    {},
    { "stats.bySender": false }
  ).insights.bounceWatch({});

  assert.deepEqual(result.data, {
    minSent: 100,
    over: [],
    threshold: 0.03,
    tooFewSends: [],
    totals: {
      bounced: null,
      campaigns: 0,
      clean: 0,
      over: 0,
      rate: null,
      sent: null,
      tooFewSends: 0,
      unknown: 0,
    },
    unknown: [],
  });
  assert.deepEqual(result.meta.notes, []);
  assert.equal(result.meta.complete, true);
});

test("bounce_watch says so when a cap stops the campaigns or a campaign's senders", async () => {
  const fewCampaigns = await single(DATA).insights.bounceWatch({
    max_campaigns: 2,
  });

  assert.equal(fewCampaigns.data.totals.campaigns, 2);
  assert.equal(fewCampaigns.meta.complete, false);
  assert.ok(
    fewCampaigns.meta.notes.includes(
      "Only the first 2 campaigns were read; more exist."
    )
  );

  const fewSenders = await single(DATA).insights.bounceWatch({
    max_senders_per_campaign: 1,
  });

  // Only s3 of Hot is read, and it is under the threshold.
  assert.deepEqual(fewSenders.data.over[0]?.senders, []);
  assert.equal(fewSenders.meta.complete, false);
  assert.ok(
    fewSenders.meta.notes.includes(
      "Only the first 1 senders of campaign Hot were read; more exist."
    )
  );
});

test("bounce_watch is refused when the adapter has no campaign stats", async () => {
  await refused(
    () => single(DATA, { "stats.campaign": false }).insights.bounceWatch({}),
    "stats.campaign"
  );
});

test("bounce_watch ranks campaigns of two tools together", async () => {
  const outbound = pair(
    {
      campaigns: [{ id: "c1", name: "Mail" }],
      senders: [{ address: "a@example.com", campaignIds: ["c1"], id: "a" }],
      stats: [
        row("c1", { bounced: 12, sent: 200 }),
        row("c1", { bounced: 12, sent: 200 }, { senderId: "a" }),
      ],
    },
    {
      campaigns: [{ channel: "linkedin", id: "k1", name: "Seats" }],
      stats: [row("k1", { bounced: 9, sent: 100 })],
    }
  );

  const { data } = await outbound.insights.bounceWatch({});

  assert.deepEqual(
    data.over.map((campaign) => [
      campaign.campaign,
      campaign.rate,
      campaign.interval,
      campaign.senders?.map((sender) => sender.sender),
    ]),
    [
      ["lntool:agency:k1", 0.09, { high: 0.1623, low: 0.0481 }, []],
      [
        "mailtool:agency:c1",
        0.06,
        { high: 0.1019, low: 0.0347 },
        ["mailtool:agency:a"],
      ],
    ]
  );
  // 21 of 300.
  assert.equal(data.totals.rate, 0.07);
});
