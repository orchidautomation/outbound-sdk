// A request cap that stops an insight part way. An insight whose answer
// still means something over part of the data keeps what it read and comes
// back with complete: false and a note naming the cap; the others still fail.
// The metered tool declares 1 request per read and sends 3, so the default
// cap, worked out from the declared costs, is reached mid-run, as it was on
// a live workspace whose reads cost more than estimated.

import assert from "node:assert/strict";
import { test } from "node:test";

import { budget } from "../../src/budget/index.ts";
import { run } from "../../src/cli/index.ts";
import { OutboundError } from "../../src/index.ts";
import {
  insightCost,
  insightTools,
  runInsightByName,
} from "../../src/insights/index.ts";
import { createFetch, json } from "../helpers/http.ts";
import { metered, NOW, over, settled, world } from "./metered.ts";

const PARTIAL = [
  "sender_capacity",
  "sender_load",
  "period_comparison",
  "campaign_ranking",
  "client_report",
];

const CAP = 60;

for (const name of PARTIAL) {
  test(`${name} returns what it read when a cap stops it part way`, async () => {
    const { http, outbound } = over(world(60, 3), { perRead: 3 });

    const result = await runInsightByName(
      outbound,
      name,
      {},
      { maxRequests: CAP, now: NOW }
    );

    assert.equal(result.meta.complete, false);
    assert.equal(http.requests.length, CAP, "not one request past the cap");
    assert.equal(result.meta.requests, CAP);

    const note = result.meta.notes.find((each) =>
      each.startsWith("Stopped after")
    );

    assert.ok(note, result.meta.notes.join("\n"));
    assert.match(
      note,
      /^Stopped after 60 requests, at the cap of 60 requests \(maxRequests\)\. Raise maxRequests\. Read (?<read>\d+) of (?<of>\d+) [a-z' ]+; the answer covers those\.$/u
    );

    const counts = /Read (?<read>\d+) of (?<of>\d+)/u.exec(note)?.groups;

    assert.ok(Number(counts?.read) < Number(counts?.of));
  });
}

test("the default cap stops an underpriced run part way and says how to raise it", async () => {
  const { http, outbound } = over(world(60, 3), { perRead: 3 });
  const cost = insightCost(outbound, "campaign_ranking");

  assert.ok(cost);

  const result = await outbound.insights.campaignRanking({}, { now: NOW });

  assert.equal(http.requests.length, cost.defaultCap);
  assert.equal(result.meta.complete, false);
  assert.ok(
    result.meta.notes.includes(
      `Stopped after ${cost.defaultCap} requests, at its default cap of ${cost.defaultCap} requests for this input. Pass maxRequests to raise it (Infinity removes the default). Read ${result.data.ranked.length + result.data.tooFewSends.length + result.data.unknown.length} of 25 campaigns; the answer covers those.`
    ),
    result.meta.notes.join("\n")
  );
});

test("an insight without partialOnCap still fails at its cap", async () => {
  const { outbound } = over(world(60, 3), { perRead: 3 });

  const outcome = await settled(
    runInsightByName(outbound, "copy_reuse", {}, { now: NOW })
  );

  assert.ok("rejected" in outcome);
  assert.ok(OutboundError.is(outcome.rejected));
  assert.match(outcome.rejected.message, /nothing it read is returned/u);
});

test("a sender listing a cap cut short counts as capped, so utilization is not made up", async () => {
  const data = world(6, 3);

  // Workspace sends in the window, from every sender together.
  const sends = ["2026-11-10", "2026-11-12"].map((date) => ({
    campaignId: "c1",
    counts: { sent: 70 },
    date,
  }));

  // One request per call: the 12 senders take two pages, so only 10 are kept.
  const { outbound } = over(
    { ...data, stats: [...(data.stats ?? []), ...sends] },
    { maxRequestsPerCall: 1 }
  );

  const result = await outbound.insights.senderCapacity({}, { now: NOW });

  assert.equal(result.meta.complete, false);
  assert.equal(result.data.capacity.activeSenders, 10);
  assert.equal(result.data.sends?.total, 140);
  assert.equal(result.data.sends?.fromUncounted, null);
  assert.equal(result.data.utilization, null);
  assert.match(
    result.meta.notes.join(" "),
    /A listing of senders kept the 10 it had read\./u
  );
});

test("a campaign named in the input is never resolved from part of the campaigns", async () => {
  const data = world(12, 3);

  const campaigns = (data.campaigns ?? []).map((campaign, index) =>
    index === 0 || index === 11 ? { ...campaign, name: "Same name" } : campaign
  );

  // The two campaigns of that name are on different pages of the listing.
  const { outbound } = over({ ...data, campaigns }, { maxRequestsPerCall: 1 });

  const outcome = await settled(
    outbound.insights.hotLeads({ campaign: "Same name" }, { now: NOW })
  );

  assert.ok("rejected" in outcome, "the name is not picked from one page");
  assert.ok(OutboundError.is(outcome.rejected));
  assert.equal(outcome.rejected.code, "RateLimited");
});

test("a run budget that stops hot_leads part way keeps the leads it listed", async () => {
  const { http, outbound } = over(world(1, 60), {
    plugins: [budget({ maxRequests: 5, per: "run" })],
  });

  const result = await runInsightByName(
    outbound,
    "hot_leads",
    {},
    { now: NOW }
  );

  assert.equal(http.requests.length, 5);
  assert.equal(result.meta.complete, false);
  assert.ok(
    result.meta.notes.some((note) =>
      note.startsWith(
        "A request cap stopped the run: The run used its budget of 5 requests to"
      )
    ),
    result.meta.notes.join("\n")
  );
  assert.match(
    result.meta.notes.join(" "),
    /A listing of leads kept the \d+ it had read\./u
  );
});

test("a budget() with a setting names it, and never requestBudget.reset()", async () => {
  const { outbound } = over(world(1, 60), {
    plugins: [
      budget({ maxRequests: 1, per: "run", setting: "--max-requests" }),
    ],
  });

  await outbound.campaigns.list();
  const spent = await settled(outbound.campaigns.list());

  assert.ok("rejected" in spent && OutboundError.is(spent.rejected));
  assert.match(
    spent.rejected.message,
    /^The run used its budget of 1 request to \S+\. Raise --max-requests\.$/u
  );
});

const cli = async (...argv: string[]) => {
  const out: string[] = [];
  const err: string[] = [];

  const code = await run(argv, {
    adapter: metered(world(60, 3), 3),
    fetch: createFetch(() => json({})).fetch,
    stderr: (text) => {
      err.push(text);
    },
    stdout: (text) => {
      out.push(text);
    },
  });

  return { code, err: err.join("\n"), out: out.join("\n") };
};

const SDK_WORDS = /requestBudget|budget\(\)|maxRequests/u;

test("the CLI names --max-requests in a cap stop, never an SDK option", async () => {
  const failed = await cli("insight", "copy_reuse", "--max-requests", "7");

  assert.equal(failed.code, 1);
  assert.match(failed.err, /--max-requests/u);
  assert.doesNotMatch(failed.err, SDK_WORDS);
  assert.doesNotMatch(failed.out, SDK_WORDS);

  const partial = await cli("insight", "campaign_ranking");

  assert.equal(partial.code, 0, partial.err);

  const { meta } = JSON.parse(partial.out) as {
    meta: { complete: boolean; notes: string[] };
  };

  assert.equal(meta.complete, false);
  assert.match(meta.notes.join(" "), /Pass --max-requests to raise it\./u);
  assert.doesNotMatch(partial.out, SDK_WORDS);
});

test("--max-requests replaces an insight's default cap in the CLI", async () => {
  const cost = insightCost(over(world(60, 3)).outbound, "campaign_ranking");

  assert.ok(cost);

  const raised = await cli(
    "insight",
    "campaign_ranking",
    "--max-requests",
    String(cost.defaultCap * 4)
  );

  const { meta } = JSON.parse(raised.out) as {
    meta: { notes: string[]; requests: number };
  };

  assert.ok(meta.requests > cost.defaultCap);
  assert.ok(
    !meta.notes.some((note) => note.startsWith("Stopped after")),
    meta.notes.join("\n")
  );
});

test("an insight tool names the setting its surface passes", async () => {
  const { outbound } = over(world(60, 3), { perRead: 3 });

  const [mcp] = insightTools(outbound, {
    capSetting: "--max-requests on outbound mcp",
    only: ["copy_reuse"],
  });

  const result = await mcp?.call({});

  assert.equal(result?.ok, false);
  assert.match(result?.next ?? "", /raise --max-requests on outbound mcp/u);
  assert.doesNotMatch(JSON.stringify(result), SDK_WORDS);

  const [sdk] = insightTools(outbound, { only: ["copy_reuse"] });
  const fallback = await sdk?.call({});

  assert.match(fallback?.next ?? "", /maxRequestsPerToolCall/u);
});
