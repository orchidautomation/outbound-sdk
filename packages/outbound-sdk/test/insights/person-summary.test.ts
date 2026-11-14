import assert from "node:assert/strict";
import { test } from "node:test";

import { OutboundError } from "../../src/index.ts";
import { agency, EMAIL_TOOL, NOW, PROFILE, single } from "./helpers.ts";

test("person_summary reports each campaign, replies and the steps replied to, across email and LinkedIn", async () => {
  const result = await agency().insights.personSummary(
    { person: " Person1@Example.com " },
    { now: NOW }
  );

  assert.equal(result.insight, "person_summary");
  assert.equal(result.data.found, true);
  assert.deepEqual(result.data.identifiers, [
    "email:person1@example.com",
    "linkedin:example-person-1",
  ]);
  assert.deepEqual(
    result.data.campaigns.map((campaign) => [
      campaign.campaign,
      campaign.campaignName,
      campaign.campaignStatus,
      campaign.channel,
      campaign.messagesSent,
      campaign.replies,
      campaign.replied,
      campaign.repliedSteps,
      campaign.lastStep,
      campaign.interest,
    ]),
    [
      [
        "mailtool:agency:c1",
        "Founders Q4",
        "active",
        "email",
        3,
        1,
        true,
        [1],
        2,
        "Interested",
      ],
      // No reply in the thread, but the vendor names the step replied to.
      [
        "mailtool:agency:c2",
        "Agencies Q3",
        "completed",
        "email",
        1,
        0,
        false,
        [3],
        0,
        null,
      ],
      [
        "mailtool:agency:c3",
        "Never sent",
        "draft",
        "email",
        0,
        0,
        false,
        [],
        null,
        null,
      ],
      [
        "lntool:agency:k1",
        "LinkedIn founders",
        "active",
        "linkedin",
        1,
        2,
        true,
        [],
        null,
        null,
      ],
    ]
  );

  const [first] = result.data.campaigns;
  assert.equal(first?.firstContactedAt, "2026-11-01T09:00:00.000Z");
  assert.equal(first?.lastContactedAt, "2026-11-06T09:00:00.000Z");
  assert.equal(first?.lastRepliedAt, "2026-11-05T10:00:00.000Z");
  assert.equal(first?.lead, "mailtool:agency:l1");
  assert.equal(first?.leadStatus, "replied");
  assert.deepEqual(result.data.totals, {
    byChannel: {
      email: { messagesSent: 4, replies: 1 },
      linkedin: { messagesSent: 1, replies: 2 },
    },
    // Three campaigns sent something; two got a reply.
    campaignReplyRate: 0.6667,
    campaigns: 4,
    campaignsReplied: 2,
    messagesSent: 5,
    replies: 3,
  });
  assert.equal(result.meta.complete, true);
  assert.equal(result.meta.computedAt, "2026-11-14T12:00:00.000Z");
  assert.equal(result.meta.provider, "combined");
});

test("person_summary finds the same person from a LinkedIn profile", async () => {
  const result = await agency().insights.personSummary({ person: PROFILE });
  assert.equal(result.data.totals.campaigns, 4);
});

test("person_summary says so when nobody matches, and counts a reply the vendor only reports as a number", async () => {
  const nobody = await agency().insights.personSummary({
    person: "nobody@example.com",
  });

  assert.equal(nobody.data.found, false);
  assert.deepEqual(nobody.data.campaigns, []);
  assert.equal(nobody.data.totals.campaignReplyRate, null);

  const counted = await single({
    campaigns: [{ id: "c1" }],
    leads: [
      {
        campaignId: "c1",
        email: "person9@example.com",
        engagement: {
          lastContactedAt: "2026-11-02T00:00:00.000Z",
          lastRepliedAt: "2026-11-03T00:00:00.000Z",
          replies: 2,
        },
        id: "l9",
      },
    ],
  }).insights.personSummary({ person: "person9@example.com" });

  const [campaign] = counted.data.campaigns;
  assert.equal(campaign?.replies, 2);
  assert.equal(campaign?.replied, true);
  assert.equal(campaign?.lastContactedAt, "2026-11-02T00:00:00.000Z");
  assert.equal(campaign?.lastRepliedAt, "2026-11-03T00:00:00.000Z");
});

test("person_summary stops at max_campaigns and rejects text that is not an address or a profile", async () => {
  const capped = await agency().insights.personSummary({
    max_campaigns: 1,
    person: "person1@example.com",
  });

  assert.equal(capped.data.campaigns.length, 1);
  assert.equal(capped.meta.complete, false);

  await assert.rejects(
    async () => await agency().insights.personSummary({ person: "Jane Doe" }),
    (error) =>
      OutboundError.is(error) &&
      error.code === "Invalid" &&
      /email address or a LinkedIn profile/u.test(error.message)
  );
});

test("person_summary is refused before any read when the adapter cannot look a person up", async () => {
  const outbound = single(EMAIL_TOOL, { "leads.lookup": false });

  await assert.rejects(
    async () =>
      await outbound.insights.personSummary({ person: "person1@example.com" }),
    (error) =>
      OutboundError.is(error) &&
      error.code === "Unsupported" &&
      /leads\.lookup/u.test(error.message)
  );
});
