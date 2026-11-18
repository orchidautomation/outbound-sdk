// campaign_diagnosis and client_report flag a campaign with many skipped
// leads: loaded, then never sent to by the tool (OUT-175). On the live
// workspace behind it a broken block-list sync left 2,251 of 31,243 leads
// skipped (7%) on one campaign and no SDK answer showed it. The limits are
// over 5% of the leads and at least 100 of them.

import assert from "node:assert/strict";
import { test } from "node:test";

import type { MemoryData, MemoryLead } from "../../src/memory/index.ts";
import { NOW, single } from "./helpers.ts";
import { row } from "./ops-helpers.ts";

const leads = (
  campaignId: string,
  length: number,
  status: NonNullable<MemoryLead["status"]>,
  from = 0
): MemoryLead[] =>
  Array.from({ length }, (_, offset) => ({
    campaignId,
    email: `${campaignId}${from + offset}@example.com`,
    id: `${campaignId}-${from + offset}`,
    status,
  }));

/** A campaign of `total` leads, `skipped` of them skipped. */
const campaignWith = (id: string, total: number, skipped: number) => [
  ...leads(id, skipped, "skipped"),
  ...leads(id, total - skipped, "active", skipped),
];

const DATA: MemoryData = {
  campaigns: [
    { id: "blocked", name: "Blocked by sync" },
    { id: "fine", name: "A few duplicates" },
    { id: "small", name: "Small list" },
  ],
  leads: [
    // 7%, the share of the live case: over 5% and over 100.
    ...campaignWith("blocked", 2000, 140),
    // 2%: duplicates kept out, as a campaign normally has.
    ...campaignWith("fine", 2000, 40),
    // 40%, but only 20 leads: under the 100 a finding needs.
    ...campaignWith("small", 50, 20),
  ],
  stats: ["blocked", "fine", "small"].flatMap((id) => [
    row(id, "2026-11-03", { contacted: 100, replied: 5, sent: 300 }),
    row(id, "2026-11-10", { contacted: 100, replied: 5, sent: 300 }),
  ]),
};

const diagnosis = async (campaign: string, capabilities = {}) =>
  (
    await single(DATA, capabilities).insights.campaignDiagnosis(
      { campaign: `memory:agency:${campaign}` },
      { now: NOW }
    )
  ).data;

const skippedFinding = async (campaign: string, capabilities = {}) =>
  (await diagnosis(campaign, capabilities)).findings.find(
    (each) => each.code === "many_skipped_leads"
  );

test("campaign_diagnosis flags skipped leads over 5% of the campaign's leads, pointing at the block list and duplicate rules", async () => {
  assert.deepEqual(await skippedFinding("blocked"), {
    code: "many_skipped_leads",
    finding:
      "140 of 2,000 leads (7%) were loaded and then skipped: the tool will never send to them. That is over the 5% limit, and usually a block list or a duplicate rule keeping out leads that were meant to be sent to.",
    next: "Check the workspace block list (and any sync that writes to it) and the campaign's rules for duplicates and leads in other campaigns; list the campaign's leads to see which were skipped.",
    numbers: {
      leads: 2000,
      limit: 0.05,
      minSkipped: 100,
      share: 0.07,
      skipped: 140,
    },
    severity: "medium",
  });
});

test("campaign_diagnosis leaves a small share, or a few leads, unflagged", async () => {
  assert.equal(await skippedFinding("fine"), undefined, "2% is under 5%");
  assert.equal(await skippedFinding("small"), undefined, "20 is under 100");
});

test("campaign_diagnosis takes its skipped limits as inputs", async () => {
  const outbound = single(DATA);

  const strict = await outbound.insights.campaignDiagnosis(
    {
      campaign: "memory:agency:fine",
      max_skipped_share: 0.01,
      min_skipped: 10,
    },
    { now: NOW }
  );

  assert.equal(
    strict.data.findings.find((each) => each.code === "many_skipped_leads")
      ?.numbers["skipped"],
    40
  );
});

test("campaign_diagnosis says skipped leads were not checked when the tool has no progress", async () => {
  const unread = await diagnosis("blocked", { "campaigns.progress": false });

  assert.equal(
    unread.findings.find((each) => each.code === "many_skipped_leads"),
    undefined
  );
  assert.ok(
    unread.notChecked.some((each) => each.startsWith("Leads contacted")),
    unread.notChecked.join(" | ")
  );
});

test("client_report lists campaigns with many skipped leads and gives each an action", async () => {
  const report = (
    await single(DATA).insights.clientReport(
      { statuses: ["active"] },
      { now: NOW }
    )
  ).data;

  assert.deepEqual(
    report.manySkippedLeads?.map((each) => [
      each.campaignName,
      each.skipped,
      each.leads,
    ]),
    [["Blocked by sync", 140, 2000]]
  );

  const actions = report.actions.filter(
    (each) => each.kind === "check_skipped_leads"
  );

  assert.deepEqual(actions, [
    {
      action:
        "Find out why Blocked by sync skipped 140 of its 2,000 leads (7%): check the block list and the campaign's duplicate rules.",
      campaign: "memory:agency:blocked",
      campaignName: "Blocked by sync",
      kind: "check_skipped_leads",
      number: 140,
    },
  ]);
});

test("client_report leaves skipped leads out, and says so, when the tool has no progress", async () => {
  const report = (
    await single(DATA, { "campaigns.progress": false }).insights.clientReport(
      { statuses: ["active"] },
      { now: NOW }
    )
  ).data;

  assert.equal(report.manySkippedLeads, null);
  assert.ok(
    report.leftOut.includes(
      "Campaigns with many skipped leads: the adapter does not report how many of a campaign's leads were skipped."
    ),
    report.leftOut.join(" | ")
  );
});

test("client_report puts the campaign with the highest share of skipped leads first", async () => {
  const data: MemoryData = {
    ...DATA,
    campaigns: [
      ...(DATA.campaigns ?? []),
      { id: "worse", name: "Mostly skipped" },
    ],
    leads: [...(DATA.leads ?? []), ...campaignWith("worse", 1000, 300)],
    stats: [
      ...(DATA.stats ?? []),
      row("worse", "2026-11-10", { contacted: 100, replied: 5, sent: 300 }),
    ],
  };

  const report = (
    await single(data).insights.clientReport(
      { statuses: ["active"] },
      { now: NOW }
    )
  ).data;

  assert.deepEqual(
    report.manySkippedLeads?.map((each) => [each.campaignName, each.share]),
    [
      ["Mostly skipped", 0.3],
      ["Blocked by sync", 0.07],
    ]
  );
});
