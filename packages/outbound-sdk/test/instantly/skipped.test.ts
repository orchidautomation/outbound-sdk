// Instantly's lead status -3 is "Skipped" (OUT-100): the lead was never sent
// to, for example a duplicate or one over a domain limit. It is not a lead of
// unknown status that may still be waiting, so it leaves no runway open.

import assert from "node:assert/strict";
import { test } from "node:test";

import { createOutbound } from "../../src/index.ts";
import { insights } from "../../src/insights/index.ts";
import { instantly } from "../../src/instantly/index.ts";
import { createTools } from "../../src/tools/index.ts";
import type { ToolResult } from "../../src/tools/index.ts";
import { createFetch } from "../helpers/http.ts";
import { CAMPAIGN, KEY } from "./suite.ts";

const DAY_MS = 86_400_000;

const daysAgo = (days: number): string =>
  new Date(Date.now() - days * DAY_MS).toISOString().slice(0, 10);

const raw = (id: string, status: number, started: boolean) => ({
  campaign: CAMPAIGN,
  email: `${id}@example.com`,
  email_open_count: 0,
  email_reply_count: 0,
  id,
  status,
  ...(started && { timestamp_last_contact: `${daysAgo(2)}T09:00:00.000Z` }),
});

// Three leads partway through, two skipped with nothing sent, one finished.
const LEADS = [
  raw("a1", 1, true),
  raw("a2", 1, true),
  raw("a3", 1, true),
  raw("s1", -3, false),
  raw("s2", -3, false),
  raw("d1", 3, true),
];

const outboundWith = (leads: readonly Record<string, unknown>[]) => {
  const http = createFetch((request) => {
    const { pathname } = new URL(request.url);

    if (pathname === "/api/v2/campaigns/analytics/daily") {
      return Response.json([
        { contacted: 9, date: daysAgo(1), new_leads_contacted: 7, sent: 9 },
      ]);
    }

    if (pathname === "/api/v2/campaigns/analytics/overview") {
      return Response.json({ new_leads_contacted_count: 4 });
    }

    if (pathname === "/api/v2/leads/list") {
      return Response.json({ items: leads });
    }

    if (pathname === `/api/v2/campaigns/${CAMPAIGN}`) {
      return Response.json({ id: CAMPAIGN, name: "Skips", status: 1 });
    }

    return Response.json({ items: [] });
  });

  return createOutbound({
    adapter: instantly({ apiKey: KEY, workspaceId: "client-a" }),
    fetch: http.fetch,
    plugins: [insights()],
  });
};

const REF = `instantly:client-a:${CAMPAIGN}`;

const runway = async (
  outbound: ReturnType<typeof outboundWith>
): Promise<Record<string, unknown>> => {
  const tool = createTools(outbound).find(
    (candidate) => candidate.name === "lead_runway"
  );

  assert.ok(tool, "lead_runway is offered");

  const result: ToolResult = await tool.call({
    campaign: REF,
    lookback_days: 7,
  } as never);

  assert.equal(result.ok, true, JSON.stringify(result));

  return (result as { data: Record<string, unknown> }).data;
};

test("instantly: a skipped lead (status -3) is skipped, not unknown, and is not a lead left to start", async () => {
  const outbound = outboundWith(LEADS);
  const page = await outbound.leads.list();

  assert.deepEqual(
    page.items.map((lead) => [lead.sourceId, lead.status, lead.progress]),
    [
      ["a1", "active", "active"],
      ["a2", "active", "active"],
      ["a3", "active", "active"],
      ["s1", "skipped", "skipped"],
      ["s2", "skipped", "skipped"],
      ["d1", "completed", "completed"],
    ]
  );

  const { data } = await outbound.insights.pipelineForecast({
    campaign: REF,
    days: 7,
  });

  assert.equal(data.byStatus.skipped, 2);
  assert.equal(data.byStatus.unknown, 0);
  assert.equal(data.remaining, 3, "only the active leads remain");
  assert.equal(data.notStarted, 0);
  // Every lead was read and none is of unknown status, so none is waiting.
  assert.equal(data.daysLeft, 0);

  const tool = await runway(outbound);

  assert.equal(tool.active_leads, 3);
  assert.equal(tool.not_started, 0);
  assert.equal(tool.runway_days, data.daysLeft, "both tools agree");
});

test("instantly: a status code the reference does not list stays unknown and leaves the runway unknown", async () => {
  const outbound = outboundWith([...LEADS.slice(0, 3), raw("x1", 7, false)]);
  const page = await outbound.leads.list();

  assert.deepEqual(
    page.items.map((lead) => lead.status),
    ["active", "active", "active", "unknown"]
  );

  const { data } = await outbound.insights.pipelineForecast({
    campaign: REF,
    days: 7,
  });

  assert.equal(data.byStatus.skipped, 0);
  assert.equal(data.byStatus.unknown, 1);
  assert.equal(data.daysLeft, null, "an unknown lead may still be waiting");
  assert.equal(data.runwayState, "unknown");
  // lead_runway reads only the active leads, as client_report does (OUT-147),
  // so a lead of unknown status is not in its count.
  assert.equal((await runway(outbound)).state, "out_of_leads");
});
