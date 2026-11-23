// The campaign scope every insight takes (OUT-200): campaign_ids, tag and
// campaign_name, each narrowing the campaigns read before any per-campaign
// read, and a scope the adapter cannot read refused before any request.

import assert from "node:assert/strict";
import { test } from "node:test";

import { createOutbound, OutboundError } from "../../src/index.ts";
import { insights } from "../../src/insights/index.ts";
import { memory } from "../../src/memory/index.ts";
import { NOW, over, settled, world } from "./metered.ts";

interface Listed {
  readonly campaign: string;
}

interface Ranking {
  readonly data: {
    readonly ranked: readonly Listed[];
    readonly tooFewSends: readonly Listed[];
    readonly unknown: readonly Listed[];
  };
  readonly meta: {
    readonly notes: readonly string[];
    readonly requests: number;
  };
}

const STATUSES = ["active", "paused", "completed"] as const;

// Six campaigns, c1 to c6: c1, c3 and c5 are tagged even, the rest odd.
const ranking = async (scope: Record<string, unknown>) => {
  const { http, outbound } = over(world(6, 5));

  const answer = (await outbound.insights.campaignRanking(
    { statuses: [...STATUSES], ...scope } as never,
    { now: NOW }
  )) as unknown as Ranking;

  const { ranked, tooFewSends, unknown } = answer.data;

  return {
    campaigns: [...ranked, ...tooFewSends, ...unknown]
      .map((each) => each.campaign.replace("memory:agency:", ""))
      .toSorted(),
    notes: answer.meta.notes,
    reads: http.requests.map((request) => new URL(request.url).pathname),
    requests: answer.meta.requests,
    sent: http.requests.length,
  };
};

test("a campaign scope reads only its campaigns, and nothing per campaign outside it", async () => {
  const all = await ranking({});

  assert.deepEqual(all.campaigns, ["c1", "c2", "c3", "c4", "c5", "c6"]);
  assert.equal(all.reads.filter((read) => read === "/listCampaigns").length, 3);

  const tagged = await ranking({ tag: "even" });

  assert.deepEqual(tagged.campaigns, ["c1", "c3", "c5"]);
  assert.deepEqual(tagged.reads, [
    "/listCampaigns",
    "/stats",
    "/stats",
    "/stats",
  ]);
  assert.equal(tagged.requests, tagged.sent);
  assert.match(
    tagged.notes.join(" "),
    /Campaign scope \(tag even\): 3 campaigns of memory:agency match\. .*filtered here, before any per-campaign read/u
  );

  const named = await ranking({ campaign_name: "*c1" });

  assert.deepEqual(named.campaigns, ["c1"]);
  assert.deepEqual(named.reads, ["/listCampaigns", "/stats"]);

  const pattern = await ranking({ campaign_name: "/campaign c[12]/i" });

  assert.deepEqual(pattern.campaigns, ["c1", "c2"]);
});

test("campaign ids are read by id with no listing, and every part given must match", async () => {
  const ids = await ranking({ campaign_ids: ["memory:agency:c2", "c4"] });

  assert.deepEqual(ids.campaigns, ["c2", "c4"]);
  assert.deepEqual(ids.reads, [
    "/getCampaign",
    "/getCampaign",
    "/stats",
    "/stats",
  ]);
  assert.equal(ids.requests, ids.sent, "each read by id is counted once");

  const both = await ranking({ campaign_ids: ["c1", "c2"], tag: "EVEN" });

  assert.deepEqual(both.campaigns, ["c1"]);
  assert.deepEqual(both.reads, ["/getCampaign", "/getCampaign", "/stats"]);
  assert.match(
    both.notes.join(" "),
    /2 campaign ids and tag EVEN\): 1 campaign/u
  );
});

test("a scope that matches nothing reads the listing and no campaign", async () => {
  const none = await ranking({ tag: "nosuch" });

  assert.deepEqual(none.campaigns, []);
  assert.deepEqual(none.reads, ["/listCampaigns"]);
  assert.match(none.notes.join(" "), /0 campaigns of memory:agency match/u);
});

test("a malformed scope is Invalid, and a tag where campaigns carry none Unsupported, before any request", async () => {
  for (const [scope, code, message] of [
    [{ campaign_name: "/(/" }, "Invalid", /not a valid regular expression/u],
    [{ campaign_ids: [] }, "Invalid", /campaign_ids/u],
    [{ tag: "  " }, "Invalid", /tag/u],
  ] as const) {
    const { http, outbound } = over(world(2, 1));

    const result = await settled(
      outbound.insights.campaignRanking(scope as never, { now: NOW })
    );

    assert.ok(
      "rejected" in result &&
        OutboundError.is(result.rejected) &&
        result.rejected.code === code &&
        message.test(result.rejected.message),
      JSON.stringify(scope)
    );
    assert.equal(http.requests.length, 0);
  }

  const tagless = createOutbound({
    adapter: memory({
      capabilities: { "campaigns.byTag": false },
      data: world(2, 1),
    }),
    plugins: [insights()],
  });

  await assert.rejects(
    tagless.insights.campaignRanking({ tag: "even" }, { now: NOW }),
    (error) =>
      OutboundError.is(error) &&
      error.code === "Unsupported" &&
      /carry no tags.*Use campaign_name or campaign_ids/u.test(error.message)
  );
});

test("a campaign outside the scope is refused once it is read, before any of its results", async () => {
  const { http, outbound } = over(world(6, 5));

  await assert.rejects(
    outbound.insights.pipelineForecast(
      { campaign: "memory:agency:c2", tag: "even" },
      { now: NOW }
    ),
    (error) =>
      OutboundError.is(error) &&
      /c2 is outside the campaign scope \(tag even\)/u.test(error.message)
  );
  assert.deepEqual(
    http.requests.map((request) => new URL(request.url).pathname),
    ["/getCampaign"]
  );
});
