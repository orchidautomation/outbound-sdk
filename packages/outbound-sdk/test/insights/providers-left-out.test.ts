// OUT-155: on a combined instance a tool with no active campaign was dropped
// from period_comparison, client_report and campaign_ranking with only a note,
// though it sent and got replies in the window (the 2026-11-17 user tests:
// HeyReach's campaigns were all completed, yet it sent 54 messages). Now each
// such tool is named in toolsLeftOut with its own counts. client_report takes
// a provider or a tag, and campaign_overview says when its filter left nothing.

import assert from "node:assert/strict";
import { test } from "node:test";

import { combine } from "../../src/combine/index.ts";
import { createOutbound, OutboundError } from "../../src/index.ts";
import { insights } from "../../src/insights/index.ts";
import { memory } from "../../src/memory/index.ts";
import type { MemoryData } from "../../src/memory/index.ts";
import { createTools } from "../../src/tools/index.ts";
import type { ToolSuccess } from "../../src/tools/index.ts";
import { NOW } from "./helpers.ts";
import { row } from "./ops-helpers.ts";

// NOW is 2026-11-14, so the last 7 complete days are 11-07 to 11-13.
const EMAIL: MemoryData = {
  campaigns: [
    { id: "e1", name: "Founders", tags: ["client-a"] },
    { id: "e2", name: "Agencies", tags: ["client-b"] },
  ],
  stats: [
    row("e1", "2026-11-09", { contacted: 100, replied: 9, sent: 300 }),
    row("e2", "2026-11-10", { contacted: 80, replied: 8, sent: 200 }),
  ],
};

// Only completed campaigns, with sends and a reply in the window.
const LINKEDIN: MemoryData = {
  campaigns: [
    { channel: "linkedin", id: "k1", name: "Seats", status: "completed" },
  ],
  stats: [row("k1", "2026-11-11", { contacted: 54, replied: 1, sent: 54 })],
};

const agency = () =>
  createOutbound({
    adapter: combine([
      memory({ data: EMAIL, name: "mailtool", workspaceId: "agency" }),
      memory({ data: LINKEDIN, name: "lntool", workspaceId: "agency" }),
    ]),
    plugins: [insights()],
  });

const LEFT_OUT = [
  {
    counts: {
      bounced: null,
      contacted: 54,
      positive: null,
      replied: 1,
      sent: 54,
    },
    provider: "lntool",
    reason: "It has no campaign active.",
    tool: "lntool:agency",
    workspaceId: "agency",
  },
];

test("period_comparison names a tool left out with its sends and replies in the period", async () => {
  const { data, meta } = await agency().insights.periodComparison(
    {},
    { now: NOW }
  );

  assert.equal(data.total.current.replied, 17, "the active campaigns only");
  assert.deepEqual(data.toolsLeftOut, LEFT_OUT);
  assert.ok(
    meta.notes.includes(
      "Left out of the totals: lntool:agency (54 sent, 1 replied), which had activity in the period but no campaign in the states asked for. Their counts are in toolsLeftOut; pass statuses to read their campaigns."
    ),
    meta.notes.join(" | ")
  );
});

test("client_report and campaign_ranking name the same tool left out", async () => {
  const outbound = agency();
  const report = await outbound.insights.clientReport({}, { now: NOW });

  assert.deepEqual(report.data.toolsLeftOut, LEFT_OUT);
  assert.equal(report.data.totalsBasis?.covers, "campaigns");

  const ranking = await outbound.insights.campaignRanking(
    { from: "2026-11-07", min_sent: 1, to: "2026-11-13" },
    { now: NOW }
  );

  assert.deepEqual(ranking.data.toolsLeftOut, LEFT_OUT);

  // Asked for completed campaigns too, nothing is left out.
  const both = await outbound.insights.periodComparison(
    { statuses: ["active", "completed"] },
    { now: NOW }
  );

  assert.deepEqual(both.data.toolsLeftOut, []);
  assert.equal(both.data.total.current.replied, 18);
});

test("client_report reads one tool of a combined instance, or one tag", async () => {
  const outbound = agency();

  const mail = await outbound.insights.clientReport(
    { provider: "mailtool" },
    { now: NOW }
  );

  assert.equal(mail.data.campaigns, 2);
  assert.deepEqual(mail.data.toolsLeftOut, []);

  const tagged = await outbound.insights.clientReport(
    { tag: "client-a" },
    { now: NOW }
  );

  assert.deepEqual(
    tagged.data.top.map((each) => each.campaignName),
    ["Founders"]
  );
  assert.equal(tagged.data.totals.current.replied, 9);
  assert.equal(tagged.data.anomalies, null, "unusual days are workspace-wide");
  assert.ok(
    tagged.data.leftOut.includes(
      "Unusual days: they are workspace-wide, so a campaign scope leaves them out."
    )
  );

  await assert.rejects(
    async () =>
      await outbound.insights.clientReport(
        { provider: "nosuch" },
        { now: NOW }
      ),
    (error) =>
      OutboundError.is(error) &&
      error.code === "Invalid" &&
      /names no tool of this instance\. Pass one of .*mailtool:agency/u.test(
        error.message
      )
  );
});

test("campaign_overview says when its status filter left the list empty", async () => {
  const outbound = createOutbound({
    adapter: memory({ data: LINKEDIN, name: "lntool", workspaceId: "agency" }),
  });

  const tool = createTools(outbound).find(
    (candidate) => candidate.name === "campaign_overview"
  );

  assert.ok(tool);

  const result = (await tool.call({} as never)) as ToolSuccess;

  assert.deepEqual((result.data as { campaigns: unknown[] }).campaigns, []);
  assert.deepEqual(result.meta.notes, [
    "No campaign is active, so the list is empty; pass status (paused, completed, draft, archived) to read the others.",
  ]);
});
