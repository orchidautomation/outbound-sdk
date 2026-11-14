import assert from "node:assert/strict";
import { test } from "node:test";

import type { MemoryData } from "../../src/memory/index.ts";
import { NOW, single } from "./helpers.ts";
import { pair, ref, refused } from "./senders-helpers.ts";

const DATA: MemoryData = {
  campaigns: [
    { id: "c1", name: "Two healthy" },
    { id: "c2", name: "One dead" },
    { id: "c3", name: "Alone" },
    { id: "c4", name: "One broken" },
    { id: "c5", name: "On hold", status: "paused" },
    { id: "c6", name: "Empty" },
    { id: "c7", name: "Alone and paused" },
  ],
  senders: [
    {
      address: "busy@example.com",
      campaignIds: ["c1", "c2", "c3", "c4"],
      dailyLimit: 41,
      id: "s1",
    },
    { address: "ok@example.com", campaignIds: ["c1", "c2"], id: "s2" },
    { address: "idle@example.com", dailyLimit: 43, id: "s3", name: "Idle" },
    {
      address: "dead@example.com",
      campaignIds: ["c2"],
      dailyLimit: 44,
      id: "s4",
      status: "disconnected",
    },
    { address: "parked@example.com", id: "s5", status: "paused" },
    { address: "held@example.com", campaignIds: ["c5"], id: "s6" },
    {
      address: "broken@example.com",
      campaignIds: ["c4"],
      id: "s7",
      status: "error",
    },
    {
      address: "resting@example.com",
      campaignIds: ["c7"],
      id: "s8",
      status: "paused",
    },
  ],
};

test("sender_load finds overused senders, unused senders and campaigns on thin or broken senders", async () => {
  const result = await single(DATA).insights.senderLoad({}, { now: NOW });
  const { data } = result;

  assert.equal(result.insight, "sender_load");
  assert.deepEqual(data.overused, [
    {
      address: "busy@example.com",
      campaignRefs: [ref("c1"), ref("c2"), ref("c3"), ref("c4")],
      campaigns: 4,
      dailyLimit: 41,
      finding:
        "busy@example.com is attached to 4 campaigns, 1 over the limit of 3.",
      name: null,
      over: 1,
      sender: ref("s1"),
      status: "active",
    },
  ]);
  // s5 is not active, so it is not "unused"; s6 is only on a paused campaign.
  assert.deepEqual(data.unused, [
    {
      address: "idle@example.com",
      dailyLimit: 43,
      name: "Idle",
      sender: ref("s3"),
      status: "active",
    },
    {
      address: "held@example.com",
      dailyLimit: null,
      name: null,
      sender: ref("s6"),
      status: "active",
    },
  ]);
  assert.deepEqual(data.campaigns, [
    {
      campaign: ref("c7"),
      finding: "Alone and paused has 1 sender, 1 of them not active.",
      inactive: [
        {
          address: "resting@example.com",
          dailyLimit: null,
          name: null,
          sender: ref("s8"),
          status: "paused",
        },
      ],
      issues: ["single_sender", "inactive_sender"],
      name: "Alone and paused",
      senders: 1,
    },
    {
      campaign: ref("c2"),
      finding: "One dead has 3 senders, 1 of them not active.",
      inactive: [
        {
          address: "dead@example.com",
          dailyLimit: 44,
          name: null,
          sender: ref("s4"),
          status: "disconnected",
        },
      ],
      issues: ["inactive_sender"],
      name: "One dead",
      senders: 3,
    },
    {
      campaign: ref("c3"),
      finding: "Alone has 1 sender.",
      inactive: [],
      issues: ["single_sender"],
      name: "Alone",
      senders: 1,
    },
    {
      campaign: ref("c4"),
      finding: "One broken has 2 senders, 1 of them not active.",
      inactive: [
        {
          address: "broken@example.com",
          dailyLimit: null,
          name: null,
          sender: ref("s7"),
          status: "error",
        },
      ],
      issues: ["inactive_sender"],
      name: "One broken",
      senders: 2,
    },
    {
      campaign: ref("c6"),
      finding: "Empty has 0 senders.",
      inactive: [],
      issues: ["no_sender"],
      name: "Empty",
      senders: 0,
    },
  ]);
  assert.deepEqual(data.totals, {
    // s1, s2, s3 and s6.
    activeSenders: 4,
    campaigns: 6,
    campaignsAtRisk: 5,
    overused: 1,
    senders: 8,
    unused: 2,
  });
  assert.equal(data.maxCampaignsPerSender, 3);
  assert.equal(result.meta.complete, true);
});

test("sender_load moves senders in and out of overused with the allowed number of campaigns", async () => {
  const strict = await single(DATA).insights.senderLoad({
    max_campaigns_per_sender: 1,
  });

  assert.deepEqual(
    strict.data.overused.map((sender) => [
      sender.sender,
      sender.campaigns,
      sender.over,
    ]),
    [
      [ref("s1"), 4, 3],
      [ref("s2"), 2, 1],
    ]
  );

  const loose = await single(DATA).insights.senderLoad({
    max_campaigns_per_sender: 4,
  });

  assert.deepEqual(loose.data.overused, []);
});

test("sender_load counts only campaigns in the statuses asked for", async () => {
  const { data } = await single(DATA).insights.senderLoad({
    statuses: ["active", "paused"],
  });

  assert.deepEqual(
    data.unused.map((sender) => sender.sender),
    [ref("s3")]
  );
  assert.equal(data.totals.campaigns, 7);
  assert.deepEqual(
    data.campaigns.find((campaign) => campaign.campaign === ref("c5"))?.issues,
    ["single_sender"]
  );

  const paused = await single(DATA).insights.senderLoad({
    statuses: ["paused"],
  });

  assert.equal(paused.data.totals.campaigns, 1);
  assert.equal(paused.data.totals.unused, 3);
});

test("sender_load filters by status itself when the vendor cannot", async () => {
  const filtered = await single(DATA, {
    "campaigns.status": false,
  }).insights.senderLoad({});

  assert.equal(filtered.data.totals.campaigns, 6);
  assert.equal(filtered.data.totals.unused, 2);
  assert.equal(filtered.meta.complete, true);

  // Without a status filter the cap counts every campaign read, paused or not.
  const capped = await single(DATA, {
    "campaigns.status": false,
  }).insights.senderLoad({ max_campaigns: 5 });

  assert.equal(capped.data.totals.campaigns, 4);
  assert.equal(capped.meta.complete, false);
});

test("sender_load has nothing to report in an empty workspace", async () => {
  const result = await single({}).insights.senderLoad({});

  assert.deepEqual(result.data, {
    campaigns: [],
    maxCampaignsPerSender: 3,
    overused: [],
    totals: {
      activeSenders: 0,
      campaigns: 0,
      campaignsAtRisk: 0,
      overused: 0,
      senders: 0,
      unused: 0,
    },
    unused: [],
  });
  assert.equal(result.meta.complete, true);
});

test("sender_load says so when a cap stops the campaigns or the senders", async () => {
  const fewCampaigns = await single(DATA).insights.senderLoad({
    max_campaigns: 2,
  });

  assert.equal(fewCampaigns.data.totals.campaigns, 2);
  assert.deepEqual(fewCampaigns.data.overused, []);
  assert.equal(fewCampaigns.meta.complete, false);
  assert.ok(
    fewCampaigns.meta.notes.includes(
      "Only the first 2 campaigns were read; more exist."
    )
  );

  // The cap is spent on active campaigns before the paused ones are reached.
  const spent = await single(DATA).insights.senderLoad({
    max_campaigns: 6,
    statuses: ["active", "paused"],
  });

  assert.equal(spent.data.totals.campaigns, 6);
  assert.equal(spent.meta.complete, false);
  assert.ok(
    spent.meta.notes.includes(
      "The cap of 6 campaigns was reached before paused campaigns were read."
    )
  );

  const fewSenders = await single(DATA).insights.senderLoad({ max_senders: 2 });

  assert.equal(fewSenders.data.totals.senders, 2);
  assert.equal(fewSenders.meta.complete, false);
  // s1 is still seen on all four of its campaigns, through each campaign's list.
  assert.equal(fewSenders.data.overused[0]?.campaigns, 4);
});

test("sender_load is refused when the adapter cannot list senders, or a campaign's senders", async () => {
  await refused(
    () => single(DATA, { "senders.byCampaign": false }).insights.senderLoad({}),
    "senders.byCampaign"
  );
  await refused(
    () => single(DATA, { "senders.list": false }).insights.senderLoad({}),
    "senders.list"
  );
});

test("sender_load keeps the senders of two tools apart", async () => {
  const outbound = pair(
    {
      campaigns: [
        { id: "c1", name: "Mail one" },
        { id: "c2", name: "Mail two" },
      ],
      senders: [
        { address: "a@example.com", campaignIds: ["c1", "c2"], id: "a" },
        { address: "b@example.com", id: "b" },
      ],
    },
    {
      campaigns: [{ channel: "linkedin", id: "c1", name: "Seats" }],
      senders: [
        {
          campaignIds: ["c1"],
          id: "a",
          linkedinUrl: "https://www.linkedin.com/in/seat-1",
          name: "Seat",
        },
      ],
    }
  );

  const { data } = await outbound.insights.senderLoad({
    max_campaigns_per_sender: 1,
  });

  // The two tools both have a campaign c1 and a sender a; refs keep them apart.
  assert.deepEqual(
    data.overused.map((sender) => [sender.sender, sender.campaignRefs]),
    [["mailtool:agency:a", ["mailtool:agency:c1", "mailtool:agency:c2"]]]
  );
  assert.deepEqual(
    data.unused.map((sender) => sender.sender),
    ["mailtool:agency:b"]
  );
  assert.deepEqual(
    data.campaigns.map((campaign) => [campaign.campaign, campaign.issues]),
    [
      ["mailtool:agency:c1", ["single_sender"]],
      ["mailtool:agency:c2", ["single_sender"]],
      ["lntool:agency:c1", ["single_sender"]],
    ]
  );
  assert.equal(data.totals.senders, 3);
});
