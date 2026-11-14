import assert from "node:assert/strict";
import { test } from "node:test";

import type { MemoryData } from "../../src/memory/index.ts";
import { NOW, single } from "./helpers.ts";
import { pair, ref, refused } from "./senders-helpers.ts";

// NOW is 2026-11-14, so the default window of 7 full days is 11-07 to 11-13.
const sent = (campaignId: string, date: string, count: number) => ({
  campaignId,
  counts: { sent: count },
  date,
});

const DATA: MemoryData = {
  campaigns: [
    { id: "c1", name: "Founders", settings: { dailyLimit: 100 } },
    { id: "c2", name: "Agencies", settings: { dailyLimit: 25 } },
    { id: "c3", name: "No limit senders", settings: { dailyLimit: 60 } },
    { channel: "linkedin", id: "c4", name: "No limit" },
    {
      id: "c5",
      name: "Paused",
      settings: { dailyLimit: 999 },
      status: "paused",
    },
    { id: "c6", name: "Nobody", settings: { dailyLimit: 15 } },
  ],
  senders: [
    {
      address: "m1@example.com",
      campaignIds: ["c1", "c2"],
      dailyLimit: 30,
      id: "m1",
    },
    {
      address: "m2@example.com",
      campaignIds: ["c1"],
      dailyLimit: 50,
      id: "m2",
    },
    { address: "m3@example.com", campaignIds: ["c3"], id: "m3" },
    {
      address: "m4@example.com",
      campaignIds: ["c2"],
      dailyLimit: 40,
      id: "m4",
      status: "paused",
    },
    {
      campaignIds: ["c4"],
      dailyLimit: 20,
      id: "li1",
      linkedinUrl: "https://www.linkedin.com/in/seat-1",
    },
  ],
  stats: [
    sent("c1", "2026-11-06", 500),
    sent("c1", "2026-11-07", 40),
    sent("c1", "2026-11-10", 30),
    sent("c2", "2026-11-10", 14),
    sent("c2", "2026-11-13", 7),
    sent("c5", "2026-11-09", 9),
    sent("c1", "2026-11-14", 300),
  ],
};

test("sender_capacity adds up capacity, ask and recent sends, and names the campaigns short of senders", async () => {
  const result = await single(DATA).insights.senderCapacity({}, { now: NOW });
  const { data } = result;

  assert.equal(result.insight, "sender_capacity");
  assert.deepEqual(data.capacity, {
    activeSenders: 4,
    // 30 + 50 + 20; the paused 40 and the sender with no limit are left out.
    daily: 100,
    inactiveSenders: 1,
    linkedinDaily: 20,
    mailboxDaily: 80,
    withLimit: 3,
    withoutLimit: 1,
  });
  assert.deepEqual(data.ask, {
    campaigns: 5,
    // 100 + 25 + 60 + 15; the paused campaign's 999 is not asked for.
    daily: 200,
    withLimit: 4,
    withoutLimit: 1,
  });
  assert.deepEqual(data.sends, {
    // 40 + 30 + 14 + 7 + 9 = 100 over 7 days.
    averageDaily: 14.2857,
    days: 7,
    daysWithData: 4,
    from: "2026-11-07",
    scope: "workspace",
    to: "2026-11-13",
    total: 100,
  });
  assert.equal(data.utilization, 0.1429);
  assert.equal(data.askRatio, 2);
  assert.deepEqual(data.shortCampaigns, [
    {
      activeSenders: 2,
      campaign: ref("c1"),
      dailyLimit: 100,
      finding:
        "Founders asks for 100 a day but its 2 active senders can send 80.",
      name: "Founders",
      senderCapacity: 80,
      senders: 2,
      shortBy: 20,
    },
    {
      activeSenders: 0,
      campaign: ref("c6"),
      dailyLimit: 15,
      finding: "Nobody asks for 15 a day but its 0 active senders can send 0.",
      name: "Nobody",
      senderCapacity: 0,
      senders: 0,
      shortBy: 15,
    },
  ]);
  // c3's only sender has no limit and c4 has no daily limit.
  assert.equal(data.uncheckedCampaigns, 2);
  assert.equal(
    data.finding,
    "3 active senders can send 100 a day. Active campaigns ask for 200, which is 100 more than that. 14.2857 a day were sent on average over the last 7 days."
  );
  assert.equal(result.meta.complete, true);
  assert.deepEqual(result.meta.notes, []);
});

test("sender_capacity averages over the days asked for", async () => {
  const one = await single(DATA).insights.senderCapacity(
    { days: 1 },
    { now: NOW }
  );

  assert.deepEqual(one.data.sends, {
    averageDaily: 7,
    days: 1,
    daysWithData: 1,
    from: "2026-11-13",
    scope: "workspace",
    to: "2026-11-13",
    total: 7,
  });
  assert.equal(one.data.utilization, 0.07);

  const four = await single(DATA).insights.senderCapacity(
    { days: 4 },
    { now: NOW }
  );

  // 11-10 to 11-13: 30 + 14 + 7 = 51 over 4 days.
  assert.equal(four.data.sends?.averageDaily, 12.75);
  assert.equal(four.data.sends?.daysWithData, 2);
});

test("sender_capacity keeps unknown limits and unknown sent counts as null", async () => {
  const result = await single({
    campaigns: [{ id: "c1" }],
    senders: [
      { address: "a@example.com", campaignIds: ["c1"], id: "a" },
      { address: "b@example.com", id: "b", status: "error" },
    ],
    stats: [{ campaignId: "c1", counts: { replied: 3 }, date: "2026-11-12" }],
  }).insights.senderCapacity({}, { now: NOW });

  assert.deepEqual(result.data.capacity, {
    activeSenders: 1,
    daily: null,
    inactiveSenders: 1,
    linkedinDaily: null,
    mailboxDaily: null,
    withLimit: 0,
    withoutLimit: 1,
  });
  assert.deepEqual(result.data.ask, {
    campaigns: 1,
    daily: null,
    withLimit: 0,
    withoutLimit: 1,
  });
  assert.equal(result.data.sends?.total, null);
  assert.equal(result.data.sends?.averageDaily, null);
  assert.equal(result.data.sends?.daysWithData, 0);
  assert.equal(result.data.utilization, null);
  assert.equal(result.data.askRatio, null);
  assert.deepEqual(result.data.shortCampaigns, []);
  assert.equal(result.data.uncheckedCampaigns, 1);
  assert.equal(
    result.data.finding,
    "No active sender reports a daily limit, so capacity is unknown."
  );
});

test("sender_capacity says the ask fits when it does, and handles an empty workspace", async () => {
  const fits = await single({
    campaigns: [{ id: "c1", settings: { dailyLimit: 45 } }],
    senders: [
      {
        address: "a@example.com",
        campaignIds: ["c1"],
        dailyLimit: 60,
        id: "a",
      },
    ],
  }).insights.senderCapacity({}, { now: NOW });

  assert.equal(
    fits.data.finding,
    "1 active sender can send 60 a day. Active campaigns ask for 45, which fits."
  );
  assert.equal(fits.data.askRatio, 0.75);
  assert.deepEqual(fits.data.shortCampaigns, []);
  assert.equal(fits.data.uncheckedCampaigns, 0);

  const empty = await single({}).insights.senderCapacity({}, { now: NOW });

  assert.equal(empty.data.capacity.daily, null);
  assert.equal(empty.data.capacity.activeSenders, 0);
  assert.deepEqual(empty.data.ask, {
    campaigns: 0,
    daily: null,
    withLimit: 0,
    withoutLimit: 0,
  });
  assert.equal(empty.data.sends?.total, null);
  assert.deepEqual(empty.data.shortCampaigns, []);
  assert.equal(empty.meta.complete, true);
});

test("sender_capacity says so when a cap stops the senders or the campaigns", async () => {
  const fewSenders = await single(DATA).insights.senderCapacity(
    { max_senders: 1 },
    { now: NOW }
  );

  assert.equal(fewSenders.data.capacity.daily, 30);
  assert.equal(fewSenders.meta.complete, false);
  assert.ok(
    fewSenders.meta.notes.includes(
      "Only the first 1 senders were read; more exist."
    )
  );
  assert.ok(
    fewSenders.meta.notes.includes(
      "Only the first 1 senders of campaign Founders were read; more exist."
    )
  );

  const fewCampaigns = await single(DATA).insights.senderCapacity(
    { max_campaigns: 2 },
    { now: NOW }
  );

  assert.equal(fewCampaigns.data.ask?.daily, 125);
  assert.equal(fewCampaigns.meta.complete, false);
});

test("sender_capacity is refused when the adapter cannot list senders", async () => {
  await refused(
    () => single(DATA, { "senders.list": false }).insights.senderCapacity({}),
    "senders.list"
  );
});

test("sender_capacity leaves out the ask and the shortfalls when settings or campaign senders cannot be read", async () => {
  const noSettings = await single(DATA, {
    "campaigns.settings": false,
  }).insights.senderCapacity({}, { now: NOW });

  assert.equal(noSettings.data.ask, null);
  assert.equal(noSettings.data.askRatio, null);
  assert.equal(noSettings.data.shortCampaigns, null);
  assert.equal(noSettings.data.uncheckedCampaigns, null);
  assert.equal(noSettings.data.capacity.daily, 100);
  assert.deepEqual(noSettings.meta.notes, [
    "The daily ask and the campaigns short of senders were left out: the adapter cannot read campaign settings.",
  ]);
  assert.equal(
    noSettings.data.finding,
    "3 active senders can send 100 a day. 14.2857 a day were sent on average over the last 7 days."
  );

  const noCampaignSenders = await single(DATA, {
    "senders.byCampaign": false,
  }).insights.senderCapacity({}, { now: NOW });

  assert.equal(noCampaignSenders.data.ask?.daily, 200);
  assert.equal(noCampaignSenders.data.shortCampaigns, null);
  assert.deepEqual(noCampaignSenders.meta.notes, [
    "The campaigns short of senders were left out: the adapter cannot list a campaign's senders.",
  ]);
});

test("sender_capacity falls back to campaign stats, then to no sends, as daily stats go away", async () => {
  const perCampaign = await single(DATA, {
    "stats.workspace": false,
  }).insights.senderCapacity({}, { now: NOW });

  assert.deepEqual(perCampaign.data.sends, {
    // Active campaigns only: 40 + 30 + 14 + 7; the paused campaign's 9 is out.
    averageDaily: 13,
    days: 7,
    daysWithData: 3,
    from: "2026-11-07",
    scope: "campaigns",
    to: "2026-11-13",
    total: 91,
  });
  assert.equal(perCampaign.data.utilization, 0.13);
  assert.deepEqual(perCampaign.meta.notes, [
    "Average daily sends cover the active campaigns read, not the whole workspace.",
  ]);

  const noScope = await single(DATA, {
    "stats.campaign": false,
    "stats.workspace": false,
  }).insights.senderCapacity({}, { now: NOW });

  assert.equal(noScope.data.sends, null);
  assert.equal(noScope.data.utilization, null);
  assert.deepEqual(noScope.meta.notes, [
    "Average daily sends left out: the adapter has no workspace or campaign stats.",
  ]);

  const noDays = await single(DATA, {
    "stats.byDay": false,
  }).insights.senderCapacity({}, { now: NOW });

  assert.equal(noDays.data.sends, null);
  assert.deepEqual(noDays.meta.notes, [
    "Average daily sends left out: the adapter has no daily stats.",
  ]);
});

test("sender_capacity reads campaigns without a status filter when the vendor has none", async () => {
  const result = await single(DATA, {
    "campaigns.status": false,
  }).insights.senderCapacity({}, { now: NOW });

  assert.equal(result.data.ask?.daily, 200);
  assert.equal(result.data.ask?.campaigns, 5);
});

test("sender_capacity adds two tools together", async () => {
  const outbound = pair(
    {
      campaigns: [{ id: "c1", name: "Mail", settings: { dailyLimit: 90 } }],
      senders: [
        {
          address: "a@example.com",
          campaignIds: ["c1"],
          dailyLimit: 35,
          id: "a",
        },
      ],
      stats: [sent("c1", "2026-11-12", 21)],
    },
    {
      campaigns: [
        {
          channel: "linkedin",
          id: "k1",
          name: "Seats",
          settings: { dailyLimit: 10 },
        },
      ],
      senders: [
        {
          campaignIds: ["k1"],
          dailyLimit: 25,
          id: "seat",
          linkedinUrl: "https://www.linkedin.com/in/seat-1",
        },
      ],
      stats: [sent("k1", "2026-11-12", 14)],
    }
  );

  const { data } = await outbound.insights.senderCapacity({}, { now: NOW });

  assert.equal(data.capacity.daily, 60);
  assert.equal(data.capacity.mailboxDaily, 35);
  assert.equal(data.capacity.linkedinDaily, 25);
  assert.equal(data.ask?.daily, 100);
  // 21 + 14 on one day, over 7 days.
  assert.equal(data.sends?.total, 35);
  assert.equal(data.sends?.averageDaily, 5);
  assert.equal(data.sends?.daysWithData, 1);
  assert.deepEqual(
    data.shortCampaigns?.map((campaign) => [
      campaign.campaign,
      campaign.shortBy,
    ]),
    [["mailtool:agency:c1", 55]]
  );
});
