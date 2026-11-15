import assert from "node:assert/strict";
import { test } from "node:test";

import { combine } from "../../src/combine/index.ts";
import { createOutbound, OutboundError } from "../../src/index.ts";
import { insights } from "../../src/insights/index.ts";
import { memory } from "../../src/memory/index.ts";
import type { MemoryData } from "../../src/memory/index.ts";
import { NOW, single } from "./helpers.ts";

const MAIL: MemoryData = {
  blocklist: [
    { id: "b1", value: "Person1@Example.com" },
    { id: "b2", value: "blocked.example" },
    { id: "b3", kind: "linkedin", value: "linkedin.com/in/Example-Person-3/" },
    { id: "b4", kind: "linkedin", value: "example-person-4" },
    { id: "b5", kind: "company", value: "Blocked Inc" },
    { id: "b6", kind: "other", value: "something" },
    { id: "b7", value: "person9@example.com" },
  ],
  campaigns: [
    { id: "c1", name: "Founders" },
    { id: "c2", name: "Agencies" },
    { id: "c3", name: "Clean" },
    { id: "c4", name: "Paused", status: "paused" },
  ],
  leads: [
    // On the list by address, and also by domain: the address wins.
    {
      campaignId: "c1",
      email: "person1@example.com",
      id: "l1",
      status: "completed",
    },
    { campaignId: "c1", email: "person2@blocked.example", id: "l2" },
    // A subdomain of a blocked domain is another domain.
    { campaignId: "c1", email: "person5@mail.blocked.example", id: "l3" },
    {
      campaignId: "c1",
      id: "l4",
      linkedinUrl: "https://www.linkedin.com/in/example-person-3?x=1",
    },
    {
      campaignId: "c2",
      email: "person4@example.com",
      id: "l5",
      linkedinUrl: "https://www.linkedin.com/in/example-person-4",
    },
    { campaignId: "c2", email: "person6@example.com", id: "l6" },
    { campaignId: "c3", email: "person7@example.com", id: "l7" },
    { campaignId: "c3", id: "l8" },
    { campaignId: "c4", email: "person9@example.com", id: "l9" },
  ],
};

test("suppression_check reports each lead on the block list with the entry and how it matched", async () => {
  const result = await single(MAIL).insights.suppressionCheck({}, { now: NOW });
  const { data } = result;

  assert.equal(result.insight, "suppression_check");
  // Leads still active first, then by campaign and lead.
  assert.deepEqual(
    data.violations.map((each) => [
      each.lead,
      each.leadStatus,
      each.campaign,
      each.matchedBy,
      each.entry,
      each.entryValue,
      each.sameTool,
    ]),
    [
      [
        "memory:agency:l2",
        "active",
        "memory:agency:c1",
        "domain",
        "memory:agency:b2",
        "blocked.example",
        true,
      ],
      [
        "memory:agency:l4",
        "active",
        "memory:agency:c1",
        "linkedin",
        "memory:agency:b3",
        // The in-memory tool lowercases every entry.
        "linkedin.com/in/example-person-3/",
        true,
      ],
      [
        "memory:agency:l5",
        "active",
        "memory:agency:c2",
        "linkedin",
        "memory:agency:b4",
        "example-person-4",
        true,
      ],
      [
        "memory:agency:l1",
        "completed",
        "memory:agency:c1",
        "email",
        "memory:agency:b1",
        "person1@example.com",
        true,
      ],
    ]
  );

  const [first] = data.violations;
  assert.equal(first?.email, "person2@blocked.example");
  assert.equal(first?.linkedinUrl, null);
  assert.equal(first?.campaignName, "Founders");
  assert.equal(
    first?.finding,
    'person2@blocked.example is in "Founders" but the block list holds the domain blocked.example.'
  );
  assert.deepEqual(data.byCampaign, [
    {
      campaign: "memory:agency:c1",
      campaignName: "Founders",
      leadsRead: 4,
      violations: 3,
    },
    {
      campaign: "memory:agency:c2",
      campaignName: "Agencies",
      leadsRead: 2,
      violations: 1,
    },
    {
      campaign: "memory:agency:c3",
      campaignName: "Clean",
      leadsRead: 2,
      violations: 0,
    },
  ]);
  assert.deepEqual(data.totals, {
    // The company entry and the "other" entry match no lead field.
    blockEntriesNotChecked: 2,
    blockEntriesRead: 7,
    byMatch: { domain: 1, email: 1, linkedin: 2 },
    campaignsRead: 3,
    leadsRead: 8,
    moreBlockEntriesExist: false,
    moreLeadsExist: false,
    violations: 4,
  });
  assert.equal(result.meta.complete, true);
});

test("suppression_check reads the campaigns in the statuses asked for", async () => {
  const result = await single(MAIL).insights.suppressionCheck({
    statuses: ["paused"],
  });

  assert.deepEqual(
    result.data.violations.map((each) => [each.lead, each.matchedBy]),
    [["memory:agency:l9", "email"]]
  );
  assert.equal(result.data.totals.campaignsRead, 1);
  assert.equal(result.data.totals.leadsRead, 1);
});

test("suppression_check finds nothing with an empty block list, no campaigns or no data", async () => {
  const noList = await single({
    ...MAIL,
    blocklist: [],
  }).insights.suppressionCheck({});

  assert.deepEqual(noList.data.violations, []);
  assert.equal(noList.data.totals.blockEntriesRead, 0);
  assert.equal(noList.data.totals.leadsRead, 8);
  assert.equal(noList.data.byCampaign.length, 3);

  const empty = await single({}).insights.suppressionCheck({});

  assert.deepEqual(empty.data, {
    byCampaign: [],
    totals: {
      blockEntriesNotChecked: 0,
      blockEntriesRead: 0,
      byMatch: { domain: 0, email: 0, linkedin: 0 },
      campaignsRead: 0,
      leadsRead: 0,
      moreBlockEntriesExist: false,
      moreLeadsExist: false,
      violations: 0,
    },
    violations: [],
  });
  assert.equal(empty.meta.complete, true);
});

test("suppression_check says the answer is partial when a cap stops a read", async () => {
  const fewEntries = await single(MAIL).insights.suppressionCheck({
    max_block_entries: 1,
  });

  // Only the address entry was read.
  assert.deepEqual(
    fewEntries.data.violations.map((each) => each.lead),
    ["memory:agency:l1"]
  );
  assert.equal(fewEntries.data.totals.blockEntriesRead, 1);
  // The entries left unread were not checked, and how many there are is unknown.
  assert.equal(fewEntries.data.totals.moreBlockEntriesExist, true);
  assert.equal(fewEntries.data.totals.blockEntriesNotChecked, null);
  assert.equal(fewEntries.meta.complete, false);
  assert.deepEqual(fewEntries.meta.notes, [
    "Stopped at 1 block list entries (max_block_entries); more exist.",
  ]);

  const fewCampaigns = await single(MAIL).insights.suppressionCheck({
    max_campaigns: 1,
  });

  assert.equal(fewCampaigns.data.totals.violations, 3);
  assert.equal(fewCampaigns.meta.complete, false);

  const fewLeads = await single(MAIL).insights.suppressionCheck({
    max_leads_per_campaign: 2,
  });

  // l1 and l2 in c1, l5 in c2.
  assert.equal(fewLeads.data.totals.violations, 3);
  assert.equal(fewLeads.data.totals.leadsRead, 6);
  assert.equal(fewLeads.data.totals.moreLeadsExist, true);
  assert.equal(fewLeads.data.totals.moreBlockEntriesExist, false);
  assert.equal(fewLeads.meta.complete, false);
});

test("suppression_check is refused without a block list or without a campaign's leads", async () => {
  for (const key of ["blocklist", "leads.byCampaign"] as const) {
    // oxlint-disable-next-line no-await-in-loop -- one capability at a time.
    await assert.rejects(
      async () =>
        await single(MAIL, { [key]: false }).insights.suppressionCheck({}),
      (error) =>
        OutboundError.is(error) &&
        error.code === "Unsupported" &&
        error.message.includes(key)
    );
  }
});

test("suppression_check matches one tool's block list against another tool's leads", async () => {
  const outbound = createOutbound({
    adapter: combine([
      memory({
        data: {
          blocklist: [
            { id: "b1", value: "person1@example.com" },
            { id: "b2", kind: "linkedin", value: "example-person-2" },
          ],
        },
        name: "mailtool",
        workspaceId: "agency",
      }),
      memory({
        data: {
          blocklist: [{ id: "x1", value: "blocked.example" }],
          campaigns: [{ channel: "linkedin", id: "k1", name: "LinkedIn" }],
          leads: [
            {
              campaignId: "k1",
              email: "person1@example.com",
              id: "p1",
            },
            {
              campaignId: "k1",
              id: "p2",
              linkedinUrl: "https://www.linkedin.com/in/example-person-2",
            },
            { campaignId: "k1", email: "person3@blocked.example", id: "p3" },
          ],
        },
        name: "lntool",
        workspaceId: "agency",
      }),
    ]),
    plugins: [insights()],
  });

  const result = await outbound.insights.suppressionCheck({});

  assert.deepEqual(
    result.data.violations.map((each) => [
      each.lead,
      each.entry,
      each.matchedBy,
      each.sameTool,
    ]),
    [
      ["lntool:agency:p1", "mailtool:agency:b1", "email", false],
      ["lntool:agency:p2", "mailtool:agency:b2", "linkedin", false],
      ["lntool:agency:p3", "lntool:agency:x1", "domain", true],
    ]
  );
  assert.equal(result.data.totals.blockEntriesRead, 3);
  assert.equal(result.meta.provider, "combined");
});
