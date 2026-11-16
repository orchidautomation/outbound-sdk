// Every insight's stated cost holds against what it really sends. A metered
// in-memory tool sends one request through the engine per adapter call and
// declares that as its costs, so the requests counted at the fetch must fall
// between the least and the most `insightCost` gives, for small and large
// workspaces, and a run at its default inputs is never stopped by its default.

import assert from "node:assert/strict";
import { test } from "node:test";

import { createOutbound, OutboundError } from "../../src/index.ts";
import type { Json } from "../../src/index.ts";
import {
  INSIGHT_TOOL_CEILING,
  insightCost,
  insights,
  INSIGHTS,
  runInsightByName,
} from "../../src/insights/index.ts";
import { smartlead } from "../../src/smartlead/index.ts";
import { suite as heyreach } from "../heyreach/suite.ts";
import { suite as instantly } from "../instantly/suite.ts";
import { CAMPAIGN, NOW, over, settled, world } from "./metered.ts";

const INPUTS: Readonly<Record<string, Record<string, Json>>> = {
  account_summary: { domain: "acme.example" },
  campaign_diagnosis: { campaign: CAMPAIGN },
  copy_audit: { campaign: CAMPAIGN },
  copy_preview: { campaign: CAMPAIGN },
  person_summary: { person: "person1@acme.example" },
  personalization_gaps: { campaign: CAMPAIGN },
  pipeline_forecast: { campaign: CAMPAIGN },
  step_funnel: { campaign: CAMPAIGN },
  variant_test: { campaign: CAMPAIGN },
};

const inputOf = (name: string): Record<string, Json> => INPUTS[name] ?? {};

for (const [label, data] of [
  ["one campaign", world(1, 3)],
  ["a few campaigns", world(4, 12)],
  ["more campaigns than the caps", world(60, 25)],
] as const) {
  test(`with ${label}, every insight sends between the least and the most its cost gives`, async () => {
    for (const insight of INSIGHTS) {
      const { http, outbound } = over(data);
      const cost = insightCost(outbound, insight.name, inputOf(insight.name));

      assert.ok(cost, `${insight.name} states its cost`);

      // oxlint-disable-next-line no-await-in-loop -- one insight at a time, each on its own fetch.
      await runInsightByName(outbound, insight.name, inputOf(insight.name), {
        now: NOW,
      });

      const sent = http.requests.length;

      if (process.env.SHOW_COSTS === "1") {
        console.log(
          `${label}\t${insight.name}\t${sent}\t${cost.min}\t${cost.max}`
        );
      }

      assert.ok(
        sent >= cost.min && sent <= cost.max,
        `${insight.name}: sent ${sent}, cost says ${cost.min} to ${cost.max}`
      );
      assert.ok(sent <= cost.defaultCap);

      // Capped at exactly what it sends, the run is not refused: the least
      // its cost gives, before and after the campaign listing, is no more.
      const exact = over(data);

      // oxlint-disable-next-line no-await-in-loop -- one insight at a time, each on its own fetch.
      await runInsightByName(
        exact.outbound,
        insight.name,
        inputOf(insight.name),
        {
          maxRequests: sent,
          now: NOW,
        }
      );

      // One fewer, and it stops with a request cap, or answers marked
      // incomplete with a note naming the cap: never a whole-looking answer.
      const short = over(data);

      // oxlint-disable-next-line no-await-in-loop -- one insight at a time, each on its own fetch.
      const outcome = await settled(
        runInsightByName(short.outbound, insight.name, inputOf(insight.name), {
          maxRequests: Math.max(1, sent - 1),
          now: NOW,
        })
      );

      if (sent > 1) {
        if ("rejected" in outcome) {
          const { rejected } = outcome;

          assert.ok(OutboundError.is(rejected), insight.name);
          assert.equal(rejected.code, "RateLimited", insight.name);
          assert.equal(rejected.limit, "call");
        } else {
          const { meta } = outcome;

          assert.equal(meta.complete, false, `${insight.name} one short`);
          assert.ok(meta.notes.some((note) => note.includes("cap")));
        }

        assert.ok(short.http.requests.length <= sent - 1);
      }
    }
  });
}

// The insights whose default inputs can cost more than an insight tool call
// may send by default, and why. Such a call stops at the ceiling and its
// result says which input to lower.
const OVER_CEILING: Readonly<Record<string, string>> = {
  bounce_watch:
    "50 campaigns, each over the bounce rate with 10 senders to read, is 600 requests at most",
};

test("every insight's default cap at its default inputs fits under the insight tools' ceiling, but the ones named", () => {
  const overCeiling = new Set<string>();

  const vendors = [
    ["smartlead", smartlead({ apiKey: "test-key" })],
    ["instantly", instantly.make()],
    ["heyreach", heyreach.make()],
  ] as const;

  for (const [vendor, adapter] of vendors) {
    const outbound = createOutbound({ adapter, plugins: [insights()] });

    const served = INSIGHTS.filter((insight) =>
      insight.needs.every((need) => outbound.capabilities[need] !== false)
    );

    for (const insight of served) {
      const cost = insightCost(outbound, insight.name, inputOf(insight.name));

      assert.ok(cost, `${insight.name} states its cost on ${vendor}`);

      if (cost.defaultCap > INSIGHT_TOOL_CEILING) {
        overCeiling.add(insight.name);
      }
    }
  }

  assert.deepEqual(
    [...overCeiling].toSorted(),
    Object.keys(OVER_CEILING).toSorted()
  );
});
