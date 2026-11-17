// client_report counts a campaign's leads left from its active leads alone
// where the tool lists them (leads.byStatus), in the shape the 2026-11-17
// live run met (OUT-131): thousands of finished leads and a few still in the
// sequence, more than max_leads_per_campaign reads.

import assert from "node:assert/strict";
import { test } from "node:test";

import { combine } from "../../src/combine/index.ts";
import { createOutbound } from "../../src/index.ts";
import { insights } from "../../src/insights/index.ts";
import { memory } from "../../src/memory/index.ts";
import type { MemoryData, MemoryLead } from "../../src/memory/index.ts";
import { createTools } from "../../src/tools/index.ts";
import { NOW, single } from "./helpers.ts";
import { row } from "./ops-helpers.ts";

const lead = (index: number): MemoryLead => ({
  campaignId: "big",
  email: `lead${index}@example.com`,
  id: `big-${index}`,
});

const finished = (index: number): MemoryLead => ({
  ...lead(index),
  status: "completed",
});

// 2,980 finished leads listed first, then 20 still in the sequence.
const BIG: MemoryData = {
  campaigns: [{ id: "big", name: "Big campaign" }],
  leads: [
    ...Array.from({ length: 2980 }, (_, index) => finished(index)),
    ...Array.from({ length: 20 }, (_, index) => lead(2980 + index)),
  ],
  stats: [
    row("big", "2026-11-03", { contacted: 70, replied: 5, sent: 400 }),
    row("big", "2026-11-10", { contacted: 70, replied: 6, sent: 400 }),
  ],
};

test("client_report reads only the active leads for the runway, so even a small cap counts them all", async () => {
  const result = await single(BIG).insights.clientReport(
    { max_leads_per_campaign: 500 },
    { now: NOW }
  );

  assert.equal(result.meta.complete, true, result.meta.notes.join(" | "));
  assert.deepEqual(
    result.data.runningOutOfLeads?.map((each) => [
      each.campaignName,
      each.remaining,
      each.daysLeft,
    ]),
    [["Big campaign", 20, 2]]
  );
});

test("without leads.byStatus the runway walks every lead, and the note names the campaign it could not count", async () => {
  const result = await single(BIG, {
    "leads.byStatus": false,
  }).insights.clientReport({ max_leads_per_campaign: 500 }, { now: NOW });

  assert.equal(result.meta.complete, false);
  assert.deepEqual(result.data.runningOutOfLeads, []);
  assert.ok(
    result.meta.notes.includes(
      "The leads left were not fully counted for 1 active campaign, so runningOutOfLeads and stalled leave it out: Big campaign. Raise max_leads_per_campaign to count them."
    ),
    result.meta.notes.join(" | ")
  );
});

const combined = () =>
  createOutbound({
    adapter: combine([
      memory({ data: BIG, name: "mailtool", workspaceId: "agency" }),
      memory({
        capabilities: { "leads.byStatus": false },
        data: { campaigns: [{ channel: "linkedin", id: "k1", name: "Seats" }] },
        name: "lntool",
        workspaceId: "agency",
      }),
    ]),
    plugins: [insights()],
  });

test("on a combined instance the runway uses the filter of the tool that owns the campaign", async () => {
  const result = await combined().insights.clientReport({}, { now: NOW });

  assert.equal(result.meta.complete, true, result.meta.notes.join(" | "));
  assert.deepEqual(
    result.data.runningOutOfLeads?.map((each) => [
      each.campaign,
      each.remaining,
    ]),
    [
      ["lntool:agency:k1", 0],
      ["mailtool:agency:big", 20],
    ]
  );
});

// The 2026-11-17 live check: on Instantly with HeyReach, lead_runway asked the
// combined instance for active leads, which only some tools can list, and was
// refused as Unsupported. It reads through the owning tool, as client_report does.
test("on a combined instance lead_runway reads through the owning tool and agrees with client_report", async () => {
  const outbound = combined();

  const tool = createTools(outbound).find(
    (candidate) => candidate.name === "lead_runway"
  );

  assert.ok(tool);

  const result = await tool.call({
    campaign: "mailtool:agency:big",
    max_leads: 500,
  } as never);

  assert.equal(result.ok, true, JSON.stringify(result));

  const { data } = result as { data: Record<string, unknown> };
  const report = await outbound.insights.clientReport({}, { now: NOW });

  const big = report.data.runningOutOfLeads?.find(
    (each) => each.campaign === "mailtool:agency:big"
  );

  assert.equal(data.counted_leads, 20, "only the active leads, under the cap");
  assert.equal(data.state, big?.state);
  assert.equal(data.active_leads, big?.remaining);
});
