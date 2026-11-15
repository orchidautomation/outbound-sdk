// Every built-in tool says in meta.requests how many vendor requests it made,
// so an agent's vendor cost can be budgeted from the results. Each tool runs on
// each vendor adapter over its fixtures, with a fetch that counts every call.

import assert from "node:assert/strict";
import { test } from "node:test";

import { clients } from "../src/clients/index.ts";
import { identity } from "../src/identity/index.ts";
import { createOutbound, MemoryRateLimitStore } from "../src/index.ts";
import type { Json } from "../src/index.ts";
import { demoData, memory } from "../src/memory/index.ts";
import { createTools } from "../src/tools/index.ts";
import type { ToolResult } from "../src/tools/index.ts";
import { fixtureHandler } from "./helpers/adapter-suite.ts";
import type { AdapterSuite } from "./helpers/adapter-suite.ts";
import { createClock } from "./helpers/clock.ts";
import { fixture } from "./helpers/fixtures.ts";
import { createFetch, json } from "./helpers/http.ts";
import type { RecordedRequest } from "./helpers/http.ts";
import { suite as heyreach } from "./heyreach/suite.ts";
import { suite as instantly } from "./instantly/suite.ts";
import { suite as smartlead } from "./smartlead/suite.ts";

const inputs = (campaign: string): Record<string, Json> => ({
  campaign_setup: { campaign },
  campaign_trend: { campaign, from: "2026-10-01", to: "2026-11-14" },
  cross_channel_lead: { person: "person1@example.com" },
  lead_runway: { campaign },
  winning_steps: { campaign },
});

// The HeyReach fixtures hold one account's status; every account gets it.
const anyAccountStatus = (request: RecordedRequest): Response | undefined =>
  request.url.includes("/li_account/GetAccountStatus/")
    ? json(fixture("heyreach", "getAccountStatus.json"))
    : undefined;

const over = (suite: AdapterSuite) => {
  const clock = createClock();
  const unrouted: string[] = [];
  const fromFixtures = fixtureHandler([suite], unrouted);

  const http = createFetch(
    (request, index) =>
      anyAccountStatus(request) ?? fromFixtures(request, index)
  );

  const outbound = createOutbound({
    adapter: suite.make(),
    fetch: http.fetch,
    plugins: [clients(), identity()],
    rateLimitStore: new MemoryRateLimitStore(),
    runtime: clock.runtime,
    share: 1,
  });

  return { http, outbound, settle: clock.settle, unrouted };
};

for (const suite of [instantly, smartlead, heyreach]) {
  test(`${suite.provider}: every tool's meta.requests is the number of fetch calls it made`, async () => {
    const { http, outbound, settle, unrouted } = over(suite);
    const given = inputs(suite.ids.campaign);
    const tools = createTools(outbound);

    assert.ok(tools.length >= 8, `${suite.provider} offers ${tools.length}`);

    for (const tool of tools) {
      const before = http.requests.length;

      // oxlint-disable-next-line no-await-in-loop -- one tool at a time, so each fetch is counted against the tool that made it.
      const result: ToolResult = await settle(
        tool.call(given[tool.name] ?? {})
      );

      const made = http.requests.length - before;

      assert.ok(result.ok, `${tool.name}: ${JSON.stringify(result)}`);
      assert.equal(
        result.meta.requests,
        made,
        `${suite.provider} ${tool.name} made ${made} requests`
      );
    }

    assert.deepEqual(unrouted, []);
  });
}

test("memory: every tool reports 0 requests", async () => {
  const outbound = createOutbound({
    adapter: memory({ data: demoData({ now: "2026-11-14T12:00:00.000Z" }) }),
    plugins: [clients(), identity()],
  });

  const given = inputs("memory:default:cmp_founders");

  for (const tool of createTools(outbound)) {
    // oxlint-disable-next-line no-await-in-loop -- one tool at a time keeps a failure easy to read.
    const result = await tool.call(given[tool.name] ?? {});

    assert.ok(result.ok, `${tool.name}: ${JSON.stringify(result)}`);
    assert.equal(result.meta.requests, 0, tool.name);
  }
});
