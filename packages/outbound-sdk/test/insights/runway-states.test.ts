// OUT-147: one runway for client_report and lead_runway, in the live the
// 2026-11-17 user tests met on Instantly. A campaign with every active lead
// already started read "50 leads remain, less than a day of sending", and one
// with no daily pace read 0 days, while lead_runway said the pace was unknown.
// Now both say out of leads or stalled, and the days are null with no pace.

import assert from "node:assert/strict";
import { test } from "node:test";

import { createOutbound } from "../../src/index.ts";
import { insights } from "../../src/insights/index.ts";
import { instantly } from "../../src/instantly/index.ts";
import type { MemoryData } from "../../src/memory/index.ts";
import { createTools } from "../../src/tools/index.ts";
import type { ToolResult } from "../../src/tools/index.ts";
import { createFetch } from "../helpers/http.ts";
import { KEY } from "../instantly/suite.ts";
import { NOW as MEMORY_NOW, single } from "./helpers.ts";
import { row } from "./ops-helpers.ts";

const DAY_MS = 86_400_000;
const NOW = Date.now();

const daysAgo = (days: number): string =>
  new Date(NOW - days * DAY_MS).toISOString().slice(0, 10);

const id = (index: number) =>
  `01a1d77f-5e23-7a9a-9112-${String(index).padStart(12, "0")}`;

interface LiveCampaign {
  readonly name: string;
  readonly started: number;
  readonly waiting: number;
  /** Instantly's daily rows: `new_leads_contacted` is leads started that day. */
  readonly days: readonly Record<string, unknown>[];
}

const CAMPAIGNS: readonly LiveCampaign[] = [
  // Every active lead is partway through the sequence and none was started
  // this week: the "50 leads remain, less than a day" campaign.
  {
    days: [
      { contacted: 120, date: daysAgo(2), new_leads_contacted: 0, sent: 120 },
    ],
    name: "Finishing",
    started: 49,
    waiting: 0,
  },
  // Every lead started and no daily row at all: the pace is unknown.
  { days: [], name: "No rows", started: 5, waiting: 0 },
  // Leads waiting to start, but none started in the window.
  {
    days: [
      { contacted: 40, date: daysAgo(3), new_leads_contacted: 0, sent: 40 },
    ],
    name: "Stalled",
    started: 0,
    waiting: 10,
  },
  // 4 waiting at 14 started over 7 days, 2 a day: 2 days.
  {
    days: [
      { contacted: 250, date: daysAgo(6), new_leads_contacted: 8, sent: 250 },
      { contacted: 56, date: daysAgo(1), new_leads_contacted: 6, sent: 56 },
    ],
    name: "Draining",
    started: 6,
    waiting: 4,
  },
];

const lead = (campaign: string, key: string, started: boolean) => {
  const raw: Record<string, unknown> = {
    campaign,
    email: `${key}@example.com`,
    email_open_count: 0,
    email_reply_count: 0,
    id: key,
    status: 1,
  };

  if (started) {
    raw.timestamp_last_contact = `${daysAgo(2)}T09:00:00.000Z`;
  }

  return raw;
};

const leadsOf = (index: number) => {
  const live = CAMPAIGNS[index] as LiveCampaign;

  return [
    ...Array.from({ length: live.started }, (_, at) =>
      lead(id(index), `s${index}-${at}`, true)
    ),
    ...Array.from({ length: live.waiting }, (_, at) =>
      lead(id(index), `w${index}-${at}`, false)
    ),
  ];
};

const campaignOf = (index: number) => ({
  id: id(index),
  name: (CAMPAIGNS[index] as LiveCampaign).name,
  status: 1,
});

const indexOf = (campaign: string | null | undefined): number =>
  CAMPAIGNS.findIndex((_, index) => id(index) === campaign);

const outbound = ({ progress = true } = {}) => {
  const http = createFetch((request) => {
    const url = new URL(request.url);
    const { pathname, searchParams } = url;

    // One campaign's progress report. Without it, Instantly has no row.
    if (pathname === "/api/v2/campaigns/analytics" && progress) {
      const at = indexOf(searchParams.get("id"));

      return Response.json(
        at < 0 ? [] : [{ campaign_id: id(at), leads_count: leadsOf(at).length }]
      );
    }

    if (pathname === "/api/v2/campaigns") {
      return Response.json({
        items: CAMPAIGNS.map((_, index) => campaignOf(index)),
      });
    }

    if (pathname === "/api/v2/campaigns/analytics/daily") {
      const at = indexOf(searchParams.get("campaign_id"));

      return Response.json(at < 0 ? [] : (CAMPAIGNS[at] as LiveCampaign).days);
    }

    if (pathname === "/api/v2/campaigns/analytics/overview") {
      return Response.json({
        emails_sent_count: 200,
        new_leads_contacted_count: 60,
        reply_count_unique: 3,
      });
    }

    if (pathname === "/api/v2/leads/list") {
      const body = JSON.parse(request.body ?? "{}") as { campaign?: string };

      return Response.json({ items: leadsOf(indexOf(body.campaign)) });
    }

    const one = /^\/api\/v2\/campaigns\/(?<one>[^/]+)$/u.exec(pathname)?.groups
      ?.one;

    if (one !== undefined && indexOf(one) >= 0) {
      return Response.json(campaignOf(indexOf(one)));
    }

    return Response.json(pathname.includes("analytics") ? [] : { items: [] });
  });

  return createOutbound({
    adapter: instantly({ apiKey: KEY, workspaceId: "client-a" }),
    fetch: http.fetch,
    plugins: [insights()],
  });
};

const leadRunway = async (index: number): Promise<ToolResult> => {
  const tool = createTools(outbound()).find(
    (candidate) => candidate.name === "lead_runway"
  );

  assert.ok(tool);

  const result = await tool.call({
    campaign: `instantly:client-a:${id(index)}`,
    lookback_days: 7,
  } as never);

  assert.equal(result.ok, true, JSON.stringify(result));

  return result;
};

const report = async (options = {}) =>
  await outbound(options).insights.clientReport({ min_sent: 1 }, { now: NOW });

test("runway: a campaign whose leads have all started is out of leads, never less than a day of sending", async () => {
  const { data } = await report();

  const finishing = data.runningOutOfLeads?.find(
    (each) => each.campaignName === "Finishing"
  );

  assert.deepEqual(
    finishing && [
      finishing.state,
      finishing.remaining,
      finishing.inSequence,
      finishing.dailyContactRate,
      finishing.daysLeft,
    ],
    ["out_of_leads", 0, 49, 0, null]
  );

  const runway = data.actions.filter((action) => action.kind === "add_leads");

  assert.equal(runway.length, 1, "one runway item for every campaign");
  assert.doesNotMatch(runway[0]?.action ?? "", /less than a day/u);
  assert.match(
    runway[0]?.action ?? "",
    /^Add leads to 3 campaigns: 2 have no lead left to start \(Finishing, No rows\); 1 runs out within 7 days at the recent pace \(Draining in about 2 days\)\.$/u
  );
});

test("runway: with no daily pace the days left are null, whatever is left to start", async () => {
  const { data } = await report();

  const byName = new Map(
    [...(data.runningOutOfLeads ?? []), ...(data.stalled ?? [])].map((each) => [
      each.campaignName,
      each,
    ])
  );

  assert.equal(byName.get("No rows")?.dailyContactRate, null);
  assert.equal(byName.get("No rows")?.daysLeft, null);
  assert.equal(byName.get("No rows")?.state, "out_of_leads");
  assert.equal(byName.get("Draining")?.daysLeft, 2);
  assert.equal(byName.get("Draining")?.state, "draining");
});

test("runway: a campaign with leads to start and no new lead started is stalled, apart from those running out", async () => {
  const { data } = await report();

  assert.deepEqual(
    data.stalled?.map((each) => [
      each.campaignName,
      each.remaining,
      each.daysLeft,
    ]),
    [["Stalled", 10, null]]
  );
  assert.ok(
    !data.runningOutOfLeads?.some((each) => each.campaignName === "Stalled")
  );
  assert.deepEqual(
    data.actions.filter((action) => action.kind === "check_stalled"),
    [
      {
        action:
          "Find out why Stalled started no new lead in the last 7 days, though 10 leads are left to start.",
        campaign: `instantly:client-a:${id(2)}`,
        campaignName: "Stalled",
        kind: "check_stalled",
        number: 1,
      },
    ]
  );
});

test("runway: lead_runway and client_report give the same state, days and completeness for each campaign", async () => {
  const { data, meta } = await report();
  const every = [...(data.runningOutOfLeads ?? []), ...(data.stalled ?? [])];

  assert.equal(every.length, CAMPAIGNS.length);

  for (const [index, live] of CAMPAIGNS.entries()) {
    const entry = every.find((each) => each.campaignName === live.name);
    // oxlint-disable-next-line no-await-in-loop -- one campaign at a time keeps the failure readable.
    const tool = await leadRunway(index);
    const toolData = (tool as { data: Record<string, unknown> }).data;

    assert.equal(toolData.state, entry?.state, live.name);
    assert.equal(toolData.runwayDays, entry?.daysLeft, live.name);
    assert.equal(toolData.contactedPerDay, entry?.dailyContactRate, live.name);
    // With no lead's progress reported, every active lead counts as not started.
    assert.equal(
      toolData.notStarted ?? toolData.activeLeads,
      entry?.remaining,
      live.name
    );
    assert.equal(toolData.inSequence, entry?.inSequence, live.name);
    assert.equal(tool.ok && tool.meta.complete, meta.complete, live.name);
  }
});

// campaign_diagnosis calls the same runway. A campaign that stopped sending
// because no lead is left to start has no pace, so no days left, and is still
// diagnosed as lead runout rather than a sending fault.
test("runway: campaign_diagnosis still names lead runout for a campaign out of leads with no pace", async () => {
  const data: MemoryData = {
    campaigns: [{ id: "dry", name: "Dry" }],
    leads: [
      ...Array.from({ length: 40 }, (_, index) => ({
        campaignId: "dry",
        engagement: { stepIndex: 3 },
        id: `done-${index}`,
        status: "completed" as const,
      })),
      { campaignId: "dry", engagement: { stepIndex: 1 }, id: "last" },
    ],
    stats: [row("dry", "2026-11-02", { contacted: 40, sent: 120 })],
  };

  const result = await single(data).insights.campaignDiagnosis(
    { campaign: "memory:agency:dry" },
    { now: MEMORY_NOW }
  );

  assert.deepEqual(
    result.data.findings.map((finding) => finding.code),
    ["out_of_leads"]
  );
});

// OUT-175: client_report reads each campaign's progress for its skipped
// leads. A campaign with no progress row was not checked, so the report is
// partial and names it, while the rest of the report stands.
test("client_report is partial, naming each campaign, when its skipped leads cannot be counted", async () => {
  const counted = await report();

  assert.deepEqual(counted.data.manySkippedLeads, []);

  const { data, meta } = await report({ progress: false });

  assert.deepEqual(data.manySkippedLeads, []);
  assert.equal(meta.complete, false);
  assert.ok(
    meta.notes.includes(
      "Skipped leads were not counted for 4 campaigns, so manySkippedLeads leaves them out: Finishing, No rows, Stalled, Draining."
    ),
    meta.notes.join(" | ")
  );
  assert.equal(
    data.runningOutOfLeads?.length,
    3,
    "the runway is still reported"
  );
});
