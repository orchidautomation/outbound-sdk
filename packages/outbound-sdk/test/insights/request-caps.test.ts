// The request cap an insight runs under: its default, worked out from the
// input; the refusal before any request when even the least the input costs
// is over the cap; the second check once the campaigns are counted; and the
// caps a caller sets, which replace or sit under the default.

import assert from "node:assert/strict";
import { test } from "node:test";

import { budget } from "../../src/budget/index.ts";
import { combine } from "../../src/combine/index.ts";
import { createOutbound, OutboundError } from "../../src/index.ts";
import {
  insightCost,
  insights,
  runInsightByName,
} from "../../src/insights/index.ts";
import { memory } from "../../src/memory/index.ts";
import { CAMPAIGN, NOW, over, settled, world } from "./metered.ts";

const rejection = async (run: Promise<unknown>): Promise<OutboundError> => {
  try {
    await run;
  } catch (error) {
    assert.ok(OutboundError.is(error));

    return error;
  }

  throw new Error("expected the run to fail");
};

test("an insight under its cap runs", async () => {
  const { http, outbound } = over(world(2, 3));

  const result = await runInsightByName(
    outbound,
    "step_funnel",
    { campaign: CAMPAIGN },
    { maxRequests: 2, now: NOW }
  );

  assert.equal(result.meta.requests, 2);
  assert.equal(http.requests.length, 2);
});

test("an insight whose least cost is over its cap is refused before any request", async () => {
  const { http, outbound } = over(world(2, 3));

  const error = await rejection(
    runInsightByName(
      outbound,
      "step_funnel",
      { campaign: CAMPAIGN },
      { maxRequests: 1, now: NOW }
    )
  );

  assert.equal(http.requests.length, 0);
  assert.equal(error.code, "RateLimited");
  assert.equal(error.limit, "call");
  assert.equal(error.permanent, true);
  assert.match(
    error.message,
    /^step_funnel needs at least 2 requests for this input, and its cap is 1 request \(maxRequests\)\. No request was sent\. Raise maxRequests\.$/u
  );
});

// Every state, so the listing takes a walk per state.
const EVERY_STATE = {
  max_campaigns: 25,
  statuses: ["active", "paused", "completed"],
};

test("a run that fits before the listing is refused once the campaigns are counted, naming the input to lower", async () => {
  const { http, outbound } = over(world(60, 25));
  // Before the listing the least is 3 status pages and 1 workspace read.
  const cost = insightCost(outbound, "client_report", EVERY_STATE);

  assert.ok(cost);
  assert.ok(cost.min <= 30);

  const error = await rejection(
    runInsightByName(outbound, "client_report", EVERY_STATE, {
      maxRequests: 30,
      now: NOW,
    })
  );

  // Only the campaign listing was read, one walk or two per state: the 25
  // campaigns found cost 2 stats reads each, which is over 30.
  const listed = http.requests.length;

  assert.ok(listed >= 3 && listed <= 6);
  assert.ok(
    http.requests.every((request) => request.url.endsWith("/listCampaigns"))
  );
  assert.equal(error.code, "RateLimited");
  assert.equal(error.limit, "call");
  assert.match(
    error.message,
    /^client_report needs at least \d+ requests for this input \(at most \d+\), and its cap is 30 requests \(maxRequests\)\. No request was sent after the first \d+ requests\. Lower max_campaigns to (?<to>\d+) or less, or raise maxRequests\.$/u
  );

  // At the value it names the least fits, so the run is not refused.
  const to = Number(/to (?<to>\d+) or less/u.exec(error.message)?.groups?.to);
  const lowered = over(world(60, 25));

  const again = await settled(
    runInsightByName(
      lowered.outbound,
      "client_report",
      { ...EVERY_STATE, max_campaigns: to },
      { maxRequests: 30, now: NOW }
    )
  );

  // It may still stop part way, since active campaigns read their leads.
  if ("rejected" in again) {
    assert.ok(OutboundError.is(again.rejected));
    assert.doesNotMatch(again.rejected.message, /needs at least/u);
  }

  assert.ok(lowered.http.requests.length <= 30);
});

test("an insight with no known cost runs as before: no default cap, no refusal", async () => {
  const outbound = createOutbound({
    adapter: combine([
      memory({ data: world(3, 3), name: "one", workspaceId: "one" }),
      memory({ data: world(3, 3), name: "two", workspaceId: "two" }),
    ]),
    plugins: [insights()],
  });

  assert.equal(insightCost(outbound, "client_report"), null);

  const result = await runInsightByName(
    outbound,
    "client_report",
    {},
    {
      now: NOW,
    }
  );

  assert.equal(result.meta.complete, true);
});

test("the default cap stops a run its declared costs underprice, naming the default and how to change it", async () => {
  // Each read really costs 3 requests, but the adapter declares 1.
  const { http, outbound } = over(world(60, 3), { perRead: 3 });
  const cost = insightCost(outbound, "copy_reuse");

  assert.ok(cost);

  const error = await rejection(
    runInsightByName(outbound, "copy_reuse", {}, { now: NOW })
  );

  assert.equal(http.requests.length, cost.defaultCap);
  assert.equal(error.code, "RateLimited");
  assert.equal(error.limit, "call");
  assert.equal(
    error.message,
    `copy_reuse stopped after ${cost.defaultCap} requests, at its default cap of ${cost.defaultCap} requests for this input, before it finished; nothing it read is returned. Pass maxRequests to raise it (Infinity removes the default).`
  );
});

test("maxRequests: Infinity removes the default cap", async () => {
  const { outbound } = over(world(4, 12), { perRead: 3 });

  const result = await runInsightByName(
    outbound,
    "copy_reuse",
    {},
    {
      maxRequests: Infinity,
      now: NOW,
    }
  );

  assert.equal(result.meta.complete, true);
});

test("a maxRequests above the default replaces it", async () => {
  const { outbound } = over(world(4, 12), { perRead: 3 });

  const result = await runInsightByName(
    outbound,
    "copy_reuse",
    {},
    {
      maxRequests: 1000,
      now: NOW,
    }
  );

  assert.equal(result.meta.complete, true);
});

test("maxRequests must be a positive integer or Infinity", async () => {
  const { http, outbound } = over(world(1, 1));

  for (const maxRequests of [0, -1, 2.5, Number.NaN]) {
    // oxlint-disable-next-line no-await-in-loop -- one bad value at a time.
    const error = await rejection(
      runInsightByName(
        outbound,
        "variant_test",
        { campaign: CAMPAIGN },
        { maxRequests, now: NOW }
      )
    );

    assert.equal(error.code, "Invalid");
  }

  assert.equal(http.requests.length, 0);
});

test("maxRequestsPerCall on the instance still caps each read under the default", async () => {
  // 25 leads at 10 a page is a listing of 3 requests; the instance allows 2.
  const { outbound } = over(world(1, 25), { maxRequestsPerCall: 2 });

  const error = await rejection(
    runInsightByName(
      outbound,
      "pipeline_forecast",
      { campaign: CAMPAIGN },
      {
        now: NOW,
      }
    )
  );

  assert.equal(error.code, "RateLimited");
  assert.match(error.message, /maxRequestsPerCall/u);
});

test("a run budget with too little left refuses the insight before any request", async () => {
  const { http, outbound } = over(world(2, 3), {
    plugins: [budget({ maxRequests: 1 })],
  });

  const error = await rejection(
    runInsightByName(
      outbound,
      "step_funnel",
      { campaign: CAMPAIGN },
      {
        now: NOW,
      }
    )
  );

  assert.equal(http.requests.length, 0);
  assert.equal(error.limit, "call");
  assert.match(error.message, /only 1 request is left of the run's budget/u);
});

test("a per-call budget still applies under the default and is not read as a run's remainder", async () => {
  const { outbound } = over(world(1, 25), {
    plugins: [budget({ maxRequests: 2, per: "call" })],
  });

  const error = await rejection(
    runInsightByName(
      outbound,
      "pipeline_forecast",
      { campaign: CAMPAIGN },
      {
        now: NOW,
      }
    )
  );

  assert.equal(error.code, "RateLimited");
  assert.match(error.message, /budget\(\)'s maxRequests/u);
});

test("concurrent reads of one insight share its one cap", async () => {
  // copy_reuse reads each campaign's sequence and stats side by side.
  const { http, outbound } = over(world(12, 3));

  await rejection(
    runInsightByName(
      outbound,
      "copy_reuse",
      {},
      {
        maxRequests: 20,
        now: NOW,
      }
    )
  );

  assert.ok(http.requests.length <= 20);
});

test("a run budget of exactly what an insight needs does not refuse it after the listing", async () => {
  const measured = over(world(6, 3));

  await runInsightByName(
    measured.outbound,
    "period_comparison",
    {},
    {
      now: NOW,
    }
  );

  const needed = measured.http.requests.length;

  const { http, outbound } = over(world(6, 3), {
    plugins: [budget({ maxRequests: needed })],
  });

  const result = await runInsightByName(
    outbound,
    "period_comparison",
    {},
    {
      now: NOW,
    }
  );

  assert.equal(result.meta.complete, true);
  assert.equal(http.requests.length, needed);
});
