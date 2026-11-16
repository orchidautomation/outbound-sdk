import assert from "node:assert/strict";
import { test } from "node:test";

import { combine } from "../../src/combine/index.ts";
import { createOutbound, OutboundError } from "../../src/index.ts";
import { insights } from "../../src/insights/index.ts";
import { memory } from "../../src/memory/index.ts";
import type { MemoryData } from "../../src/memory/index.ts";
import { NOW, single } from "./helpers.ts";

const PROFILE_1 = "https://www.linkedin.com/in/example-person-1";

const MAIL: MemoryData = {
  campaigns: [
    { id: "c1", name: "Founders" },
    { id: "c2", name: "Agencies" },
    { id: "c3", name: "Partners" },
    { id: "c4", name: "Old push", status: "paused" },
  ],
  leads: [
    // person1 is in three active campaigns and one paused one.
    { campaignId: "c1", email: "person1@example.com", id: "l1" },
    {
      campaignId: "c2",
      email: "Person1@Example.com",
      id: "l2",
      status: "completed",
    },
    { campaignId: "c3", email: "person1@example.com", id: "l3" },
    { campaignId: "c4", email: "person1@example.com", id: "l4" },
    // person2 is in two.
    { campaignId: "c1", email: "person2@example.com", id: "l5" },
    { campaignId: "c3", email: "person2@example.com", id: "l6" },
    // person3 is twice in one campaign: a duplicate, not a collision.
    { campaignId: "c2", email: "person3@example.com", id: "l7" },
    { campaignId: "c2", email: "person3@example.com", id: "l8" },
    // Nothing to match on.
    { campaignId: "c1", id: "l9" },
    { campaignId: "c2", id: "l10" },
  ],
};

const LINKEDIN: MemoryData = {
  campaigns: [{ channel: "linkedin", id: "k1", name: "LinkedIn founders" }],
  leads: [
    // The profile alone ties this record to nothing in the email tool...
    { campaignId: "k1", id: "p1", linkedinUrl: `${PROFILE_1}/?x=1` },
    // ...until a record carries both the address and the profile.
    {
      campaignId: "k1",
      email: "person4@example.com",
      id: "p2",
      linkedinUrl: "https://linkedin.com/in/Example-Person-4",
    },
  ],
};

const both = (mail: MemoryData = MAIL) =>
  createOutbound({
    adapter: combine([
      memory({ data: mail, name: "mailtool", workspaceId: "agency" }),
      memory({ data: LINKEDIN, name: "lntool", workspaceId: "agency" }),
    ]),
    plugins: [insights()],
  });

test("lead_collisions lists each person in two or more active campaigns, most campaigns first", async () => {
  const result = await single(MAIL).insights.leadCollisions({}, { now: NOW });
  const { data } = result;

  assert.equal(result.insight, "lead_collisions");
  assert.deepEqual(
    data.collisions.map((each) => [
      each.identifiers,
      each.campaignCount,
      each.stillActive,
      each.scope,
      each.providers,
      each.channels,
    ]),
    [
      // The paused campaign c4 is not read, so three campaigns, two still active for the lead.
      [
        ["email:person1@example.com"],
        3,
        2,
        "within_tool",
        ["memory"],
        ["email"],
      ],
      [
        ["email:person2@example.com"],
        2,
        2,
        "within_tool",
        ["memory"],
        ["email"],
      ],
    ]
  );
  assert.deepEqual(data.collisions[0]?.campaigns, [
    {
      campaign: "memory:agency:c1",
      campaignName: "Founders",
      channel: "email",
      lead: "memory:agency:l1",
      leadStatus: "active",
      provider: "memory",
    },
    {
      campaign: "memory:agency:c2",
      campaignName: "Agencies",
      channel: "email",
      lead: "memory:agency:l2",
      leadStatus: "completed",
      provider: "memory",
    },
    {
      campaign: "memory:agency:c3",
      campaignName: "Partners",
      channel: "email",
      lead: "memory:agency:l3",
      leadStatus: "active",
      provider: "memory",
    },
  ]);
  assert.equal(
    data.collisions[0]?.finding,
    'person1@example.com is in 2 memory campaigns at once, and was in "Agencies" (completed).'
  );
  assert.deepEqual(data.totals, {
    acrossTools: 0,
    campaignsRead: 3,
    collisions: 2,
    concurrent: 2,
    // 3 in c1, 4 in c2, 2 in c3.
    leadsRead: 9,
    leadsWithoutIdentifier: 2,
    pastOverlaps: 0,
    withinTool: 2,
  });
  assert.equal(result.meta.complete, true);
});

test("lead_collisions counts the paused campaign when statuses asks for it", async () => {
  const result = await single(MAIL).insights.leadCollisions({
    statuses: ["active", "paused", "active"],
  });

  assert.equal(result.data.collisions[0]?.campaignCount, 4);
  assert.equal(result.data.totals.campaignsRead, 4);
  assert.equal(result.data.totals.leadsRead, 10);

  const pausedOnly = await single(MAIL).insights.leadCollisions({
    statuses: ["paused"],
  });

  assert.deepEqual(pausedOnly.data.collisions, []);
  assert.equal(pausedOnly.data.totals.campaignsRead, 1);
});

test("lead_collisions marks a collision across tools and joins an address to a profile through one record", async () => {
  const withProfile: MemoryData = {
    ...MAIL,
    leads: [
      ...(MAIL.leads ?? []),
      {
        campaignId: "c2",
        email: "person4@example.com",
        id: "l11",
      },
      // This record carries both identifiers of person1.
      {
        campaignId: "c2",
        email: "person1b@example.com",
        id: "l12",
        linkedinUrl: PROFILE_1,
      },
    ],
  };

  const result = await both(withProfile).insights.leadCollisions({});

  assert.deepEqual(
    result.data.collisions.map((each) => [
      each.identifiers,
      each.campaignCount,
      each.scope,
      each.providers,
      each.channels,
    ]),
    [
      [
        ["email:person1@example.com"],
        3,
        "within_tool",
        ["mailtool"],
        ["email"],
      ],
      // Sorted after the three-campaign collision, before the within-tool pair.
      [
        ["email:person1b@example.com", "linkedin:example-person-1"],
        2,
        "across_tools",
        ["mailtool", "lntool"],
        ["email", "linkedin"],
      ],
      [
        ["email:person4@example.com", "linkedin:example-person-4"],
        2,
        "across_tools",
        ["mailtool", "lntool"],
        ["email", "linkedin"],
      ],
      [
        ["email:person2@example.com"],
        2,
        "within_tool",
        ["mailtool"],
        ["email"],
      ],
    ]
  );
  assert.equal(
    result.data.collisions[1]?.finding,
    "person1b@example.com is in 2 campaigns across mailtool and lntool (email and linkedin) at once."
  );
  assert.equal(result.data.totals.acrossTools, 2);
  assert.equal(result.data.totals.withinTool, 2);
  assert.equal(result.meta.provider, "combined");
});

const PAST: MemoryData = {
  campaigns: [
    { id: "c1", name: "UG - AI Campaign" },
    { id: "c2", name: "UG - Reachdesk Customers" },
  ],
  leads: [
    // person1 finished one campaign and is now in another.
    {
      campaignId: "c1",
      email: "person1@example.com",
      id: "l1",
      status: "completed",
    },
    { campaignId: "c2", email: "person1@example.com", id: "l2" },
    // person2 is no longer sent to in either.
    {
      campaignId: "c1",
      email: "person2@example.com",
      id: "l3",
      status: "replied",
    },
    {
      campaignId: "c2",
      email: "person2@example.com",
      id: "l4",
      status: "unsubscribed",
    },
    // person3 is active in both.
    { campaignId: "c1", email: "person3@example.com", id: "l5" },
    { campaignId: "c2", email: "person3@example.com", id: "l6" },
  ],
};

test("lead_collisions reports only people active in two campaigns at once by default", async () => {
  const result = await single(PAST).insights.leadCollisions({});

  assert.deepEqual(
    result.data.collisions.map((each) => [each.identifiers, each.stillActive]),
    [[["email:person3@example.com"], 2]]
  );
  assert.equal(
    result.data.collisions[0]?.finding,
    "person3@example.com is in 2 memory campaigns at once."
  );
  assert.equal(result.data.totals.collisions, 1);
  assert.equal(result.data.totals.concurrent, 1);
  assert.equal(result.data.totals.pastOverlaps, 2);
});

test("lead_collisions reports past overlaps with include_past, without saying at once", async () => {
  const result = await single(PAST).insights.leadCollisions({
    include_past: true,
  });

  assert.deepEqual(
    result.data.collisions.map((each) => [
      each.identifiers[0],
      each.stillActive,
      each.finding,
    ]),
    [
      // Most active campaigns first.
      [
        "email:person3@example.com",
        2,
        "person3@example.com is in 2 memory campaigns at once.",
      ],
      [
        "email:person1@example.com",
        1,
        'person1@example.com was in "UG - AI Campaign" (completed) and is now active in "UG - Reachdesk Customers".',
      ],
      [
        "email:person2@example.com",
        0,
        'person2@example.com was in "UG - AI Campaign" (replied) and "UG - Reachdesk Customers" (unsubscribed), and is active in none of them now.',
      ],
    ]
  );
  assert.deepEqual(
    result.data.collisions
      .filter((each) => each.stillActive < 2)
      .map((each) => each.finding.includes("at once")),
    [false, false]
  );
  assert.equal(result.data.totals.collisions, 3);
  assert.equal(result.data.totals.concurrent, 1);
  assert.equal(result.data.totals.pastOverlaps, 2);
  assert.equal(result.data.totals.withinTool, 3);
});

test("lead_collisions refuses an include_past that is not a boolean", async () => {
  await assert.rejects(
    async () =>
      await single(PAST).insights.leadCollisions({
        // @ts-expect-error -- an input the schema rejects.
        include_past: "yes",
      }),
    (error) =>
      OutboundError.is(error) &&
      error.code === "Invalid" &&
      error.message.includes("include_past")
  );
});

test("lead_collisions finds nothing with no campaigns, and nothing across tools without a shared identifier", async () => {
  const empty = await single({}).insights.leadCollisions({});

  assert.deepEqual(empty.data, {
    collisions: [],
    totals: {
      acrossTools: 0,
      campaignsRead: 0,
      collisions: 0,
      concurrent: 0,
      leadsRead: 0,
      leadsWithoutIdentifier: 0,
      pastOverlaps: 0,
      withinTool: 0,
    },
  });
  assert.equal(empty.meta.complete, true);

  const apart = await both().insights.leadCollisions({});
  assert.equal(apart.data.totals.acrossTools, 0);
  assert.equal(apart.data.totals.collisions, 2);
});

test("lead_collisions says the answer is partial when a cap stops a read", async () => {
  const fewCampaigns = await single(MAIL).insights.leadCollisions({
    max_campaigns: 2,
  });

  // c1 and c2 only: person1 is in both but completed c2, person2 only in c1.
  assert.deepEqual(fewCampaigns.data.collisions, []);
  assert.equal(fewCampaigns.data.totals.pastOverlaps, 1);
  assert.equal(fewCampaigns.meta.complete, false);
  assert.deepEqual(fewCampaigns.meta.notes, [
    "Stopped at 2 campaigns (max_campaigns); more exist.",
  ]);

  const fewLeads = await single(MAIL).insights.leadCollisions({
    max_leads_per_campaign: 1,
  });

  // The first lead of c1, c2 and c3 is person1 each time.
  assert.equal(fewLeads.data.totals.leadsRead, 3);
  assert.equal(fewLeads.data.collisions[0]?.campaignCount, 3);
  assert.equal(fewLeads.meta.complete, false);
  assert.deepEqual(fewLeads.meta.notes, [
    "Stopped at 1 lead of a campaign (max_leads_per_campaign); more exist.",
  ]);

  const twoStatuses = await single(MAIL).insights.leadCollisions({
    max_campaigns: 3,
    statuses: ["active", "paused"],
  });

  assert.equal(twoStatuses.data.totals.campaignsRead, 3);
  assert.equal(twoStatuses.meta.complete, false);
  assert.deepEqual(twoStatuses.meta.notes, [
    "Stopped at 3 campaigns (max_campaigns); more exist.",
  ]);
});

test("lead_collisions filters campaigns itself when the tool has no status filter", async () => {
  const outbound = single(MAIL, { "campaigns.status": false });
  const result = await outbound.insights.leadCollisions({});

  assert.equal(result.data.totals.campaignsRead, 3);
  assert.equal(result.data.collisions[0]?.campaignCount, 3);
  assert.equal(result.meta.complete, true);

  const capped = await outbound.insights.leadCollisions({ max_campaigns: 3 });
  assert.equal(capped.meta.complete, false, "the fourth campaign was not read");
});

test("lead_collisions is refused when a campaign's leads cannot be listed", async () => {
  await assert.rejects(
    async () =>
      await single(MAIL, { "leads.byCampaign": false }).insights.leadCollisions(
        {}
      ),
    (error) =>
      OutboundError.is(error) &&
      error.code === "Unsupported" &&
      /leads\.byCampaign/u.test(error.message)
  );
});
