// campaign_diagnosis flags a count of leads contacted that cannot be unique
// leads (OUT-90). The numbers are the four-step campaign of OUT-86: 383 leads,
// 430 leads started once leads removed after starting are counted, and 1,404
// when lead-step contacts were read as leads.

import assert from "node:assert/strict";
import { test } from "node:test";

import type { MemoryData } from "../../src/memory/index.ts";
import { NOW, single } from "./helpers.ts";
import { row } from "./ops-helpers.ts";

const withContacted = (contacted: number): MemoryData => ({
  campaigns: [{ id: "c1", name: "Four steps" }],
  leads: Array.from({ length: 383 }, (_, index) => ({
    campaignId: "c1",
    email: `lead${index}@example.com`,
    id: `l${index}`,
    status: "active" as const,
  })),
  stats: [row("c1", "2026-11-10", { contacted, replied: 20, sent: 1501 })],
});

const C1 = { campaign: "memory:agency:c1" };

const contactedFinding = (data: MemoryData, capabilities = {}) =>
  single(data, capabilities)
    .insights.campaignDiagnosis(C1, { now: NOW })
    .then((result) => ({
      finding: result.data.findings.find(
        (each) => each.code === "contacted_exceeds_leads"
      ),
      notChecked: result.data.notChecked,
    }));

test("campaign_diagnosis flags leads contacted at several times the campaign's leads", async () => {
  const { finding } = await contactedFinding(withContacted(1404));

  assert.deepEqual(finding, {
    code: "contacted_exceeds_leads",
    finding:
      "The vendor reports 1404 leads contacted against 383 leads in the campaign, more than 2 times as many. Leads contacted cannot be that far over the leads, so that count is not unique leads and the per-lead rates are not to be trusted.",
    next: "Report it as an adapter fault, and judge the campaign on sends until it is fixed.",
    numbers: { contacted: 1404, leads: 383, limit: 2 },
    severity: "high",
  });
});

test("campaign_diagnosis does not flag leads contacted a little over the leads, as removed leads make it", async () => {
  assert.equal((await contactedFinding(withContacted(430))).finding, undefined);
  // Exactly twice the leads is still allowed; one more is not.
  assert.equal((await contactedFinding(withContacted(766))).finding, undefined);
  assert.equal(
    (await contactedFinding(withContacted(767))).finding?.code,
    "contacted_exceeds_leads"
  );
});

test("campaign_diagnosis does not judge leads contacted with no leads to compare, or no progress read", async () => {
  const empty = { ...withContacted(1404), leads: [] };

  assert.equal((await contactedFinding(empty)).finding, undefined);

  const unread = await contactedFinding(withContacted(1404), {
    "campaigns.progress": false,
  });

  assert.equal(unread.finding, undefined);
  assert.ok(
    unread.notChecked.includes(
      "Leads contacted against the campaign's leads: the adapter does not serve campaign progress."
    ),
    unread.notChecked.join(" | ")
  );
});
