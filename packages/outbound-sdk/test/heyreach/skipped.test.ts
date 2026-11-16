// HeyReach's Excluded leads are skipped (OUT-106). The statuses and their
// meaning come from the OpenAPI enum for GetCampaignsForLead.leadStatus and
// the help article "Why are my leads In progress, Not enrolled yet; Finished,
// Paused, Pending; Failed; Excluded?", both read on 2026-11-16 (see
// docs/research/heyreach.md).

import assert from "node:assert/strict";
import { test } from "node:test";

import { harness } from "../helpers/adapter-suite.ts";
import { fixture } from "../helpers/fixtures.ts";
import { CAMPAIGN, LEAD, suite } from "./suite.ts";

const path = (request: { url: string }): string =>
  new URL(request.url).pathname.replace("/api/public", "");

test("heyreach: every documented leadStatus of a lookup maps to a progress, and Excluded is skipped", async () => {
  // Each documented value, then one HeyReach has not documented.
  const cases = [
    ["Pending", "active"],
    ["InSequence", "active"],
    ["Finished", "completed"],
    ["Paused", "paused"],
    ["Failed", "unknown"],
    ["Excluded", "skipped"],
    ["PendingOrExcludedToBeCalculated", "unknown"],
    ["Skipped", "unknown"],
  ] as const;

  const { outbound, settle } = harness(suite, (request) =>
    path(request) === "/campaign/GetCampaignsForLead"
      ? Response.json({
          items: cases.map(([leadStatus], index) => ({
            campaignId: 300_000 + index,
            campaignName: `Example campaign ${index}`,
            campaignStatus: "IN_PROGRESS",
            creationTime: "2024-09-30T21:00:00.000000Z",
            leadStatus,
          })),
          leadFullName: "Alex Example",
          totalCount: cases.length,
        })
      : undefined
  );

  const leads = await settle(
    outbound.leads.listAll({ linkedinUrl: LEAD }).toArray()
  );

  assert.deepEqual(
    leads.map((lead) => [lead.progress, lead.status]),
    cases.map(([, progress]) => [progress, progress]),
    "a lookup reports no reply, and LinkedIn has no bounce or unsubscribe"
  );

  const excluded = leads[cases.findIndex(([value]) => value === "Excluded")];
  assert.equal(excluded?.bounced, null, "LinkedIn has no bounce");
});

test("heyreach: a campaign's progress counts its excluded leads as skipped", async () => {
  const campaign = fixture("heyreach", "getCampaign.json") as {
    progressStats: Record<string, number>;
  };

  const progressWith = async (stats: Record<string, number>) => {
    const { outbound, settle } = harness(suite, (request) =>
      path(request) === "/campaign/GetById"
        ? Response.json({ ...campaign, progressStats: stats })
        : undefined
    );

    return await settle(outbound.campaign(CAMPAIGN).progress());
  };

  const counted = await progressWith({
    ...campaign.progressStats,
    totalUsers: 12,
    totalUsersExcluded: 3,
  });

  assert.equal(counted.skipped, 3, "totalUsersExcluded");
  assert.equal(counted.leads, 12);
  assert.equal(counted.failed, 0, "failed leads are not skipped");

  const { totalUsersExcluded: _, ...withoutExcluded } = campaign.progressStats;
  const missing = await progressWith(withoutExcluded);
  assert.equal(missing.skipped, null, "a missing count is null, never 0");
});

test("heyreach: the field coverage says a campaign's skipped count is read from the vendor", () => {
  const { outbound } = harness(suite);

  assert.equal(outbound.fields.campaignProgress.skipped, "exact");
  assert.equal(outbound.fields.campaignProgress.blocked, false);
});
