// A reply counts as the person replying only when it was not automatic, and
// a lead the vendor labels negative earns no reply points (OUT-52).

import assert from "node:assert/strict";
import { test } from "node:test";

import type { MemoryData } from "../../src/memory/index.ts";
import { NOW, single } from "./helpers.ts";

const RANKED: MemoryData = {
  campaigns: [{ id: "c1" }],
  leads: [
    {
      campaignId: "c1",
      email: "person1@example.com",
      engagement: { opens: 1 },
      firstName: "Keen",
      id: "keen",
      interest: "Interested",
    },
    // Replied twice today, then marked not interested: no category mapped.
    {
      campaignId: "c1",
      email: "person2@example.com",
      engagement: {
        clicks: 1,
        lastRepliedAt: "2026-11-14T10:00:00.000Z",
        replies: 2,
      },
      firstName: "Angry",
      id: "angry",
      interest: "Not Interested",
      status: "replied",
    },
    {
      campaignId: "c1",
      email: "person3@example.com",
      engagement: { clicks: 3, opens: 5 },
      firstName: "Warm",
      id: "warm",
    },
    // The vendor maps the label to the negative category.
    {
      campaignId: "c1",
      email: "person4@example.com",
      engagement: { lastRepliedAt: "2026-11-14T11:00:00.000Z", replies: 1 },
      id: "wrong",
      interest: "Wrong Person",
      interestCategory: "negative",
    },
  ],
};

test("hot_leads gives a lead labelled negative no points at all, lists it after every engaged lead, and its reason names the label", async () => {
  const result = await single(RANKED).insights.hotLeads({}, { now: NOW });

  assert.deepEqual(
    result.data.leads.map((each) => [each.name, each.score]),
    [
      // 50 for the label and 1 open.
      ["Keen", 51],
      // 3 clicks x 5 and 5 opens.
      ["Warm", 20],
      // The two who said no score nothing and come last, latest reply first.
      [null, 0],
      ["Angry", 0],
    ]
  );

  const angry = result.data.leads.find((each) => each.name === "Angry");

  // Its click earns nothing either; an open count it lacks stays unknown.
  assert.deepEqual(angry?.parts, {
    clicks: 0,
    interest: 0,
    opens: null,
    recency: 0,
    replies: 0,
  });
  assert.equal(
    angry?.reason,
    "marked Not Interested, so it earns no points."
  );
  assert.equal(result.data.totals.negative, 2);
  assert.equal(result.data.totals.autoReplied, 0);
  // Only the leads with a score above 0.
  assert.equal(result.data.totals.hot, 2);
});

test("hot_leads ranks a negative lead with many clicks and opens below a lead that replied once, and only when there is room", async () => {
  const data: MemoryData = {
    campaigns: [{ id: "c1" }],
    leads: [
      {
        campaignId: "c1",
        email: "person1@example.com",
        engagement: { clicks: 3, opens: 20 },
        firstName: "Clicky",
        id: "clicky",
        interest: "Not interested",
      },
      {
        campaignId: "c1",
        email: "person2@example.com",
        engagement: { replies: 1 },
        firstName: "Once",
        id: "once",
      },
    ],
  };
  const outbound = single(data);

  const all = await outbound.insights.hotLeads({}, { now: NOW });

  // 1 reply x 10; the negative lead's 3 clicks and 20 opens earn nothing.
  assert.deepEqual(
    all.data.leads.map((each) => [each.name, each.score, each.reason]),
    [
      ["Once", 10, "replied 1 time."],
      ["Clicky", 0, "marked Not interested, so it earns no points."],
    ]
  );

  const one = await outbound.insights.hotLeads({ limit: 1 }, { now: NOW });

  assert.deepEqual(
    one.data.leads.map((each) => each.name),
    ["Once"]
  );
});

test("hot_leads scores a negative label the caller lists as positive", async () => {
  const result = await single(RANKED).insights.hotLeads(
    { positive_labels: ["Not Interested"] },
    { now: NOW }
  );

  const [first] = result.data.leads;

  // 50 for the label, 2 replies x 10, 1 click x 5 and 20 x (1 - 2 hours / 14 days).
  assert.equal(first?.name, "Angry");
  assert.equal(first?.parts.replies, 20);
  assert.equal(result.data.totals.negative, 1);
});

const OUT_OF_OFFICE: MemoryData = {
  campaigns: [
    { id: "c1", name: "Q4" },
    { id: "c2", name: "Q3" },
  ],
  leads: [
    {
      campaignId: "c1",
      email: "person1@acme.example",
      engagement: { lastRepliedAt: "2026-11-10T09:01:00.000Z", replies: 1 },
      id: "l1",
      interest: "Out of Office",
    },
    {
      campaignId: "c2",
      email: "person2@acme.example",
      engagement: { lastRepliedAt: "2026-11-11T09:00:00.000Z", replies: 1 },
      id: "l2",
      interest: "Interested",
    },
  ],
  messages: [
    {
      campaignId: "c1",
      direction: "out",
      id: "o1",
      leadId: "l1",
      sentAt: "2026-11-10T09:00:00.000Z",
      stepIndex: 0,
    },
    {
      campaignId: "c1",
      category: "ooo",
      direction: "in",
      id: "i1",
      isAuto: true,
      leadId: "l1",
      sentAt: "2026-11-10T09:01:00.000Z",
    },
  ],
};

test("person_summary does not count an out-of-office reply as the person replying", async () => {
  const result = await single(OUT_OF_OFFICE).insights.personSummary({
    person: "person1@acme.example",
  });

  const [campaign] = result.data.campaigns;

  assert.equal(campaign?.autoReplied, true);
  assert.equal(campaign?.replied, false);
  assert.equal(campaign?.replies, 0);
  assert.equal(campaign?.lastRepliedAt, null);
  assert.deepEqual(campaign?.repliedSteps, []);
  assert.equal(result.data.totals.campaignsReplied, 0);
  assert.equal(result.data.totals.campaignReplyRate, 0);
  assert.equal(result.data.totals.replies, 0);
  assert.match(result.meta.notes.join(" "), /out-of-office or bounced/u);
});

test("account_summary does not count an out-of-office reply as the person replying", async () => {
  const result = await single(OUT_OF_OFFICE).insights.accountSummary({
    domain: "acme.example",
  });

  const auto = result.data.people.find(
    (person) => person.email === "person1@acme.example"
  );

  assert.equal(auto?.replied, false);
  assert.equal(auto?.replies, null);
  assert.equal(auto?.lastRepliedAt, null);
  assert.equal(auto?.records[0]?.autoReplied, true);
  // The record keeps what the vendor counted.
  assert.equal(auto?.records[0]?.replies, 1);
  assert.equal(result.data.totals.replied, 1);
  assert.equal(result.data.lastReply?.email, "person2@acme.example");
});

test("an interest category of bounce or ooo counts as automatic too", async () => {
  const result = await single({
    campaigns: [{ id: "c1" }],
    leads: [
      {
        campaignId: "c1",
        email: "person1@acme.example",
        engagement: { replies: 1 },
        id: "l1",
        interest: "Bounced",
        interestCategory: "bounce",
      },
      {
        campaignId: "c1",
        email: "person2@acme.example",
        engagement: { replies: 1 },
        id: "l2",
        interest: "Away",
        interestCategory: "ooo",
      },
    ],
  }).insights.accountSummary({ domain: "acme.example" });

  assert.equal(result.data.totals.replied, 0);
});
