// Every number tells apart zero, unknown and unchecked, and carries what it
// was divided by and when it was computed (OUT-141). Each test reproduces a
// gap that read as a zero or hid a denominator.

import assert from "node:assert/strict";
import { test } from "node:test";

import { createOutbound, MemoryRateLimitStore } from "../../src/index.ts";
import { insights, insightTools } from "../../src/insights/index.ts";
import { memory } from "../../src/memory/index.ts";
import type { MemoryData } from "../../src/memory/index.ts";
import { createTools } from "../../src/tools/index.ts";
import { fixtureHandler } from "../helpers/adapter-suite.ts";
import { createClock } from "../helpers/clock.ts";
import { fixture } from "../helpers/fixtures.ts";
import { createFetch, json } from "../helpers/http.ts";
import { suite } from "../instantly/suite.ts";
import { NOW, single } from "./helpers.ts";
import { row } from "./ops-helpers.ts";

const overview = fixture(
  "instantly",
  "getCampaignAnalyticsOverview.json"
) as Record<string, unknown>;

const campaign = fixture("instantly", "getCampaign.json") as Record<
  string,
  unknown
>;

const STARTED = "01a1d77f-5e23-7a9a-9112-000000000001";
const FOLLOWING_UP = "01a1d77f-5e23-7a9a-9112-000000000002";

// Instantly counts contacted as leads whose sequence started in the range
// (new_leads_contacted_count). A campaign that only sent follow-ups in the
// range reports 0 of them, with sends and replies.
const ANALYTICS: Record<string, Record<string, unknown>> = {
  [FOLLOWING_UP]: {
    ...overview,
    emails_sent_count: 800,
    new_leads_contacted_count: 0,
    reply_count: 20,
    reply_count_unique: 20,
  },
  [STARTED]: overview,
};

const instantly = () => {
  const clock = createClock();
  const fromFixtures = fixtureHandler([suite], []);

  const http = createFetch((request, index) => {
    const url = new URL(request.url);

    if (url.pathname === "/api/v2/campaigns") {
      return json({
        items: [STARTED, FOLLOWING_UP].map((id, at) => ({
          ...campaign,
          id,
          name: `Campaign ${at + 1}`,
          status: 1,
        })),
      });
    }

    const id = url.searchParams.get("id");

    if (url.pathname === "/api/v2/campaigns/analytics/overview" && id) {
      return json(ANALYTICS[id]);
    }

    return fromFixtures(request, index);
  });

  const outbound = createOutbound({
    adapter: suite.make(),
    fetch: http.fetch,
    plugins: [insights()],
    rateLimitStore: new MemoryRateLimitStore(),
    runtime: clock.runtime,
    share: 1,
  });

  return { outbound, settle: clock.settle };
};

test("channel_mix divides every campaign's replies by one basis on Instantly, never leads for one and sends for another", async () => {
  const { outbound, settle } = instantly();

  const result = await settle(
    outbound.insights.channelMix(
      { from: "2026-11-01", statuses: ["active"], to: "2026-11-13" },
      { now: NOW }
    )
  );

  const [email] = result.data.channels;

  assert.ok(email);
  assert.equal(result.data.replyRateBasis, "sent");
  // Before, the rate was replies over 200 leads plus 800 sends.
  assert.equal(email.replyRate.of, email.sent);
  assert.equal(email.replyRate.count, email.replied);
  assert.equal(email.sent, 5800);
});

const FOLLOW_UPS: MemoryData = {
  campaigns: [
    { id: "a", name: "Started", tags: ["acme"] },
    { id: "b", name: "Following up", tags: ["acme"] },
  ],
  stats: [
    row("a", "2026-11-03", { contacted: 200, replied: 10, sent: 300 }),
    row("b", "2026-11-04", { contacted: 0, replied: 20, sent: 800 }),
  ],
};

test("tag_rollup names its reply rate basis and keeps it the same for every campaign", async () => {
  const result = await single(FOLLOW_UPS).insights.tagRollup(
    { from: "2026-11-01", to: "2026-11-30" },
    { now: NOW }
  );

  const [acme] = result.data.tags;

  assert.equal(result.data.replyRateBasis, "sent");
  assert.deepEqual(
    [acme?.replyRate.count, acme?.replyRate.of, acme?.sent],
    [30, 1100, 1100]
  );
});

test("tag_rollup keeps leads contacted as the basis when every campaign with replies contacted leads", async () => {
  const result = await single({
    ...FOLLOW_UPS,
    stats: [
      row("a", "2026-11-03", { contacted: 200, replied: 10, sent: 300 }),
      row("b", "2026-11-04", { contacted: 0, replied: 0, sent: 800 }),
    ],
  }).insights.tagRollup({ from: "2026-11-01", to: "2026-11-30" }, { now: NOW });

  assert.equal(result.data.replyRateBasis, "contacted");
  assert.deepEqual(
    [result.data.tags[0]?.replyRate.count, result.data.tags[0]?.replyRate.of],
    [10, 200]
  );
});

test("deliverability_check gives the warmup counts behind the spam rate", async () => {
  const outbound = createOutbound({
    adapter: memory({
      data: {
        senders: [
          {
            address: "sender1@example.com",
            health: {
              checkedAt: "2026-11-13T08:00:00.000Z",
              warmup: { inbox: 90, spam: 10 },
            },
            id: "s1",
            status: "active",
          },
          {
            address: "sender2@example.com",
            health: { warmup: { inbox: 0, spam: 0 } },
            id: "s2",
            status: "active",
          },
        ],
      },
    }),
  });

  const tool = createTools(outbound).find(
    (candidate) => candidate.name === "deliverability_check"
  );

  assert.ok(tool);
  const result = await tool.call({});
  assert.ok(result.ok, JSON.stringify(result));

  const rows = (
    result.data as {
      senders: {
        address: string;
        checkedAt: string | null;
        warmupInbox: number | null;
        warmupSpam: number | null;
        warmupSpamRate: number | null;
      }[];
    }
  ).senders.toSorted((left, right) =>
    left.address.localeCompare(right.address)
  );

  assert.deepEqual(
    rows.map((each) => [
      each.warmupSpam,
      each.warmupInbox,
      each.warmupSpamRate,
      each.checkedAt,
    ]),
    [
      [10, 90, 0.1, "2026-11-13T08:00:00.000Z"],
      // Nothing landed: the counts are 0 and the rate is unknown, not 0.
      [0, 0, null, null],
    ]
  );
});

test("every tool result says when its numbers were computed", async () => {
  const outbound = createOutbound({
    adapter: memory({ data: FOLLOW_UPS }),
    plugins: [insights()],
  });

  const tools = [...createTools(outbound), ...insightTools(outbound)];

  for (const name of ["campaign_overview", "channel_mix"]) {
    const tool = tools.find((candidate) => candidate.name === name);
    assert.ok(tool, name);
    const before = Date.now();
    const result = await tool.call({});
    assert.ok(result.ok, JSON.stringify(result));
    const at = Date.parse(result.meta.computedAt ?? "");
    assert.ok(at >= before - 1000 && at <= Date.now(), name);
  }
});

test("campaign_overview passes the vendor's notes on, says what period it read, and calls a missing row unknown", async () => {
  const outbound = createOutbound({
    adapter: memory({
      data: {
        campaigns: [
          { id: "a", name: "Reported" },
          { id: "b", name: "Silent" },
        ],
        stats: [
          row("a", "2026-11-03", { contacted: 20, replied: 0, sent: 40 }),
        ],
      },
    }),
  });

  const tool = createTools(outbound).find(
    (candidate) => candidate.name === "campaign_overview"
  );

  assert.ok(tool);
  const result = await tool.call({ from: "2026-11-01", to: "2026-11-30" });
  assert.ok(result.ok, JSON.stringify(result));

  const data = result.data as {
    campaigns: {
      campaignName: string;
      metrics: { replied: number | null } | null;
    }[];
    period: { from: string | null; to: string | null };
  };

  assert.deepEqual(data.period, { from: "2026-11-01", to: "2026-11-30" });
  // A reported 0 stays 0; a campaign with no row is null, with a note.
  assert.deepEqual(
    data.campaigns.map((each) => [
      each.campaignName,
      each.metrics?.replied ?? null,
    ]),
    [
      ["Reported", 0],
      ["Silent", null],
    ]
  );
  assert.equal(
    data.campaigns.find((each) => each.campaignName === "Silent")?.metrics,
    null
  );
  assert.deepEqual(result.meta.notes, [
    "The vendor reported no stats for 1 campaign in this range, so metrics is null there: unknown, not zero.",
  ]);
});
