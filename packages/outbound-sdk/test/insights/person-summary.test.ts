import assert from "node:assert/strict";
import { test } from "node:test";

import { combine } from "../../src/combine/index.ts";
import { createOutbound, OutboundError } from "../../src/index.ts";
import { insights } from "../../src/insights/index.ts";
import { memory } from "../../src/memory/index.ts";
import { redact } from "../../src/redact/index.ts";
import type { RedactField } from "../../src/redact/index.ts";
import {
  agency,
  EMAIL_TOOL,
  LINKEDIN_TOOL,
  NOW,
  PROFILE,
  single,
} from "./helpers.ts";

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
          stepIndex: 4,
        },
        id: "l9",
      },
    ],
    messages: [
      // The vendor kept one sent message and one reply, which names its own step.
      {
        campaignId: "c1",
        direction: "out",
        id: "x1",
        leadId: "l9",
        sentAt: "2026-11-02T00:00:00.000Z",
        stepIndex: 4,
      },
      {
        campaignId: "c1",
        direction: "in",
        id: "x2",
        leadId: "l9",
        sentAt: "2026-11-03T00:00:00.000Z",
        stepIndex: 3,
      },
    ],
  }).insights.personSummary({ person: "person9@example.com" });

  const [campaign] = counted.data.campaigns;
  assert.equal(campaign?.replies, 2);
  assert.equal(campaign?.replied, true);
  assert.equal(campaign?.messagesSent, 5, "the last step sent is step 4");
  assert.deepEqual(campaign?.repliedSteps, [3], "the reply's own step wins");
  assert.match(counted.meta.notes[0] ?? "", /counted from the last step/u);
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
  // The note names the cap, as the other insights do.
  assert.deepEqual(capped.meta.notes, [
    "Stopped at 1 record of the person (max_campaigns); more exist.",
  ]);

  await assert.rejects(
    async () => await agency().insights.personSummary({ person: "Jane Doe" }),
    (error) =>
      OutboundError.is(error) &&
      error.code === "Invalid" &&
      /email address, a LinkedIn profile URL or a lead ref/u.test(error.message)
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

test("person_summary keeps one record per campaign when a vendor uses one lead id in every campaign", async () => {
  // Smartlead's lead id is global: the same lead, and the same ref, in two campaigns.
  const outbound = single({
    campaigns: [
      { id: "c1", name: "First" },
      { id: "c2", name: "Second" },
    ],
    leads: [
      { campaignId: "c1", email: "person5@example.com", id: "shared" },
      { campaignId: "c2", email: "person5@example.com", id: "shared" },
    ],
    messages: [
      {
        campaignId: "c1",
        direction: "out",
        id: "a1",
        leadId: "shared",
        sentAt: "2026-11-01T00:00:00.000Z",
        stepIndex: 0,
      },
      {
        campaignId: "c2",
        direction: "out",
        id: "b1",
        leadId: "shared",
        sentAt: "2026-11-02T00:00:00.000Z",
        stepIndex: 0,
      },
      {
        campaignId: "c2",
        direction: "out",
        id: "b2",
        leadId: "shared",
        sentAt: "2026-11-03T00:00:00.000Z",
        stepIndex: 1,
      },
      {
        campaignId: "c2",
        direction: "in",
        id: "b3",
        leadId: "shared",
        sentAt: "2026-11-04T00:00:00.000Z",
      },
    ],
  });

  assert.equal(
    (await outbound.leads.listAll({ email: "person5@example.com" }).toArray())
      .length,
    2,
    "a lookup keeps both campaign records although they share a ref"
  );

  const result = await outbound.insights.personSummary({
    person: "person5@example.com",
  });

  assert.deepEqual(
    result.data.campaigns.map((campaign) => [
      campaign.campaignName,
      campaign.messagesSent,
      campaign.replies,
      campaign.repliedSteps,
    ]),
    [
      ["First", 1, 0, []],
      ["Second", 2, 1, [1]],
    ],
    "each campaign counts its own messages"
  );
  assert.equal(result.data.totals.messagesSent, 3);
  assert.equal(result.data.totals.campaignReplyRate, 0.5);
});

/** The two tools behind redact, masking these fields (all by default). */
const masked = (fields?: readonly RedactField[]) =>
  createOutbound({
    adapter: combine([
      memory({ data: EMAIL_TOOL, name: "mailtool", workspaceId: "agency" }),
      memory({ data: LINKEDIN_TOOL, name: "lntool", workspaceId: "agency" }),
    ]),
    plugins: [redact(fields === undefined ? {} : { fields }), insights()],
  });

test("person_summary refuses an identifier redact masks, and looks a person up by the one it leaves", async () => {
  for (const [fields, person] of [
    [undefined, "person1@example.com"],
    [["email"], "person1@example.com"],
    [["linkedin"], PROFILE],
  ] as const) {
    await assert.rejects(
      masked(fields).insights.personSummary({ person }),
      (error) =>
        OutboundError.is(error) &&
        error.code === "Unsupported" &&
        /redact plugin masks/u.test(error.message)
    );
  }

  // With only LinkedIn masked an email still finds its records, and the
  // answer says the LinkedIn records could not be linked.
  const byEmail = await masked(["linkedin"]).insights.personSummary({
    person: "person1@example.com",
  });

  assert.equal(byEmail.data.found, true);
  assert.deepEqual(byEmail.data.identifiers, ["email:person1@example.com"]);
  assert.equal(byEmail.data.totals.campaigns, 3);
  assert.equal(byEmail.meta.complete, false);
  assert.match(byEmail.meta.notes.join(" "), /masks LinkedIn profiles/u);

  // Masking something other than the identifiers leaves the lookup working.
  const named = await masked(["name"]).insights.personSummary({
    person: PROFILE,
  });

  assert.equal(named.data.found, true);
  assert.equal(named.data.totals.campaigns, 4);
});
