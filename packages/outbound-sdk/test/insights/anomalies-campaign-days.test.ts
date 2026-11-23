import assert from "node:assert/strict";
import { test } from "node:test";

import { createOutbound } from "../../src/index.ts";
import type { CapabilityDeclaration } from "../../src/index.ts";
import { insights } from "../../src/insights/index.ts";
import { memory } from "../../src/memory/index.ts";
import type { MemoryData } from "../../src/memory/index.ts";
import { NOW } from "./helpers.ts";
import { row } from "./ops-helpers.ts";

// NOW is 2026-11-14: with days 5 the days checked are 11-09 to 11-13, each
// held to the 7 days before it. c1 sends about 60 a day and c2 about 40, and
// both drop on 11-12, so the workspace drops from about 100 to 20.
const DAYS = [
  ["2026-11-02", 60, 40],
  ["2026-11-03", 61, 39],
  ["2026-11-04", 59, 41],
  ["2026-11-05", 60, 40],
  ["2026-11-06", 62, 40],
  ["2026-11-07", 58, 40],
  ["2026-11-08", 60, 41],
  ["2026-11-09", 60, 40],
  ["2026-11-10", 61, 39],
  ["2026-11-11", 60, 40],
  ["2026-11-12", 12, 8],
  ["2026-11-13", 60, 40],
] as const;

const DATA: MemoryData = {
  campaigns: [
    { id: "c1", status: "active" },
    { id: "c2", status: "completed" },
  ],
  stats: DAYS.flatMap(([date, one, two]) => [
    row("c1", date, { sent: one }),
    row("c2", date, { sent: two }),
  ]),
};

const INPUT = { baseline_days: 7, days: 5, metrics: ["sent" as const] };

/** An instance whose adapter records the campaign listings and stats reads it serves. */
const counted = (capabilities: CapabilityDeclaration) => {
  const adapter = memory({ capabilities, data: DATA, workspaceId: "agency" });
  const reads: string[] = [];
  const { listCampaigns, stats } = adapter;

  assert.ok(stats);

  const outbound = createOutbound({
    adapter: {
      ...adapter,
      listCampaigns: async (query, ctx) => {
        reads.push("campaigns");

        return await listCampaigns(query, ctx);
      },
      stats: async (query, ctx) => {
        reads.push(`${query.scope} ${query.scopeId ?? ""}`.trim());

        return await stats(query, ctx);
      },
    },
    plugins: [insights()],
  });

  return { outbound, reads };
};

test("anomalies without workspace stats adds up every campaign's days, as derived, with a note", async () => {
  const exact = counted({});
  const added = counted({ "stats.workspace": false });

  const fromWorkspace = await exact.outbound.insights.anomalies(INPUT, {
    now: NOW,
  });

  const fromCampaigns = await added.outbound.insights.anomalies(INPUT, {
    now: NOW,
  });

  assert.deepEqual(exact.reads, ["workspace"]);
  // One listing, then each campaign whatever its state.
  assert.deepEqual(added.reads, ["campaigns", "campaign c1", "campaign c2"]);

  assert.equal(fromCampaigns.data.scope, "workspace");
  assert.deepEqual(
    fromCampaigns.data.anomalies.map((each) => [each.date, each.value]),
    [["2026-11-12", 20]]
  );
  assert.deepEqual(fromCampaigns.data.anomalies, fromWorkspace.data.anomalies);

  assert.equal(fromWorkspace.meta.evidence, "exact");
  assert.equal(fromCampaigns.meta.evidence, "derived");
  assert.equal(fromCampaigns.meta.complete, true);
  assert.ok(
    fromCampaigns.meta.notes.includes(
      "The adapter has no workspace stats, so each day is the 2 campaigns read added up, a lead in two of them counted in both."
    ),
    fromCampaigns.meta.notes.join(" | ")
  );
});

test("anomalies without workspace or campaign stats is refused before any read", async () => {
  const { outbound, reads } = counted({
    "stats.campaign": false,
    "stats.workspace": false,
  });

  await assert.rejects(outbound.insights.anomalies(INPUT, { now: NOW }), {
    code: "Unsupported",
  });
  assert.deepEqual(reads, []);
});
