import assert from "node:assert/strict";
import { test } from "node:test";

import { combine } from "../../src/combine/index.ts";
import { createOutbound, OutboundError } from "../../src/index.ts";
import { insights, insightTools } from "../../src/insights/index.ts";
import { memory } from "../../src/memory/index.ts";
import type { MemoryData } from "../../src/memory/index.ts";
import { NOW, single } from "./helpers.ts";
import { pair, row, unsupported } from "./ops-helpers.ts";

const DATA: MemoryData = {
  campaigns: [
    { id: "c1", name: "One", tags: ["client-a", "saas"] },
    { id: "c2", name: "Two", tags: ["client-a"] },
    { id: "c3", name: "Three" },
    { id: "c4", name: "Four", tags: ["tiny"] },
    { id: "c5", name: "Five", tags: ["dark"] },
    { id: "c6", name: "Six", status: "archived", tags: ["old"] },
  ],
  stats: [
    row("c1", "2026-11-02", {
      bounced: 4,
      contacted: 400,
      positive: 8,
      replied: 40,
      sent: 400,
    }),
    row("c2", "2026-11-03", {
      bounced: 12,
      contacted: 600,
      positive: 3,
      replied: 30,
      sent: 600,
    }),
    row("c2", "2026-08-03", { contacted: 100, replied: 50, sent: 100 }),
    row("c3", "2026-11-04", {
      bounced: 1,
      contacted: 100,
      positive: 1,
      replied: 2,
      sent: 100,
    }),
    row("c4", "2026-11-05", { contacted: 20, replied: 5, sent: 20 }),
    // Sends only: every other count is unknown.
    row("c5", "2026-11-06", { sent: 80 }),
    row("c6", "2026-11-06", { contacted: 500, replied: 400, sent: 500 }),
  ],
};

const NOVEMBER = { from: "2026-11-01", to: "2026-11-30" };

test("tag_rollup adds campaigns up per tag, counting a campaign in each of its tags", async () => {
  const result = await single(DATA).insights.tagRollup(NOVEMBER, { now: NOW });

  assert.equal(result.insight, "tag_rollup");
  assert.equal(result.data.campaigns, 5);
  assert.deepEqual(result.data.period, NOVEMBER);
  // Sorted by the low end of the reply rate interval; the tag with no reply
  // count comes last.
  assert.deepEqual(
    result.data.tags.map((each) => each.tag),
    ["saas", "client-a", null, "dark"]
  );

  const [saas, clientA, untagged, dark] = result.data.tags;

  assert.deepEqual(saas, {
    bounceRate: { count: 4, high: 0.0254, low: 0.0039, of: 400, rate: 0.01 },
    bounced: 4,
    campaigns: 1,
    contacted: 400,
    positive: 8,
    positiveRate: { count: 8, high: 0.039, low: 0.0102, of: 400, rate: 0.02 },
    replied: 40,
    replyRate: { count: 40, high: 0.1333, low: 0.0743, of: 400, rate: 0.1 },
    sent: 400,
    tag: "saas",
  });
  // c1 and c2 together: 400 + 600 sends, 40 + 30 replies, 8 + 3 positive, 4 + 12 bounces.
  assert.deepEqual(clientA, {
    bounceRate: { count: 16, high: 0.0258, low: 0.0099, of: 1000, rate: 0.016 },
    bounced: 16,
    campaigns: 2,
    contacted: 1000,
    positive: 11,
    positiveRate: {
      count: 11,
      high: 0.0196,
      low: 0.0062,
      of: 1000,
      rate: 0.011,
    },
    replied: 70,
    replyRate: { count: 70, high: 0.0875, low: 0.0558, of: 1000, rate: 0.07 },
    sent: 1000,
    tag: "client-a",
  });
  assert.deepEqual(
    [untagged?.campaigns, untagged?.sent, untagged?.replyRate.rate],
    [1, 100, 0.02]
  );
  assert.equal(untagged?.replyRate.low, 0.0055);
  assert.deepEqual(
    [dark?.sent, dark?.replied, dark?.replyRate.rate, dark?.bounceRate.rate],
    [80, null, null, null]
  );
  assert.deepEqual(
    result.data.tooFewSends.map((each) => [each.tag, each.sent]),
    [["tiny", 20]]
  );
  assert.equal(result.meta.complete, true);
});

test("tag_rollup divides by messages sent when a campaign contacted no new lead, and says so", async () => {
  const result = await single({
    campaigns: [
      { id: "c1", name: "Fresh", tags: ["client-a"] },
      { id: "c2", name: "Follow-ups", tags: ["client-b"] },
    ],
    stats: [
      row("c1", "2026-11-03", { contacted: 400, replied: 20, sent: 400 }),
      row("c2", "2026-11-04", { contacted: 0, replied: 6, sent: 300 }),
    ],
  }).insights.tagRollup(NOVEMBER, { now: NOW });

  assert.equal(result.data.replyRateBasis, "sent");
  assert.ok(
    result.meta.notes.some((note) =>
      note.startsWith("Reply rates divide by messages sent")
    )
  );
});

test("tag_rollup moves a tag in or out with min_sent, and follows the range and the statuses", async () => {
  const outbound = single(DATA);

  const loose = await outbound.insights.tagRollup({
    ...NOVEMBER,
    min_sent: 10,
  });

  // 5 of 20 has a low end of 11.19%, above every other tag.
  assert.deepEqual(
    loose.data.tags.map((each) => [each.tag, each.replyRate.low]),
    [
      ["tiny", 0.1119],
      ["saas", 0.0743],
      ["client-a", 0.0558],
      [null, 0.0055],
      ["dark", null],
    ]
  );
  assert.deepEqual(loose.data.tooFewSends, []);

  const strict = await outbound.insights.tagRollup({
    ...NOVEMBER,
    min_sent: 500,
  });

  assert.deepEqual(
    strict.data.tags.map((each) => each.tag),
    ["client-a"]
  );
  assert.deepEqual(
    strict.data.tooFewSends.map((each) => each.tag),
    ["tiny", "saas", null, "dark"]
  );

  const whole = await outbound.insights.tagRollup({});
  const clientA = whole.data.tags.find((each) => each.tag === "client-a");

  // c2's August row adds 100 sends and 50 replies: 120 of 1,100.
  assert.deepEqual(
    [clientA?.sent, clientA?.replied, clientA?.replyRate.rate],
    [1100, 120, 0.1091]
  );

  const archived = await outbound.insights.tagRollup({
    statuses: ["archived"],
  });

  assert.deepEqual(
    archived.data.tags.map((each) => [each.tag, each.replyRate.rate]),
    [["old", 0.8]]
  );
});

test("tag_rollup has nothing to report without campaigns, says when the cap cut the list, and needs campaign stats", async () => {
  const empty = await single({}).insights.tagRollup({});

  assert.deepEqual(empty.data.tags, []);
  assert.deepEqual(empty.data.tooFewSends, []);
  assert.equal(empty.data.campaigns, 0);

  // Two tags on the same campaign have the same numbers: the name breaks the tie.
  const tied = await single({
    campaigns: [{ id: "t1", tags: ["zeta", "alpha"] }, { id: "t2" }],
    stats: [
      row("t1", "2026-11-02", { contacted: 100, replied: 10, sent: 100 }),
    ],
  }).insights.tagRollup({ min_sent: 0 });

  assert.deepEqual(
    tied.data.tags.map((each) => [each.tag, each.sent, each.replyRate.rate]),
    [
      ["alpha", 100, 0.1],
      ["zeta", 100, 0.1],
      // The untagged campaign reports nothing at all.
      [null, null, null],
    ]
  );

  const capped = await single(DATA).insights.tagRollup({
    ...NOVEMBER,
    max_campaigns: 2,
  });

  assert.equal(capped.data.campaigns, 2);
  assert.equal(capped.meta.complete, false);

  await assert.rejects(
    async () =>
      await single(DATA, { "stats.campaign": false }).insights.tagRollup({}),
    unsupported("stats.campaign")
  );
});

test("tag_rollup groups campaigns of two tools under the same tag", async () => {
  const result = await pair(DATA, {
    campaigns: [{ channel: "linkedin", id: "k1", tags: ["saas", "saas"] }],
    stats: [
      row("k1", "2026-11-05", { contacted: 100, replied: 30, sent: 100 }),
    ],
  }).insights.tagRollup(NOVEMBER);

  const saas = result.data.tags.find((each) => each.tag === "saas");

  // 40 of 400 by email plus 30 of 100 on LinkedIn; a tag repeated on one campaign counts once.
  assert.deepEqual(
    [saas?.campaigns, saas?.sent, saas?.replied, saas?.replyRate.rate],
    [2, 500, 70, 0.14]
  );
  assert.equal(result.meta.provider, "combined");
});

test("tag_rollup divides a count only by the sends of the campaigns that report it, and says which tag left campaigns out", async () => {
  const result = await single({
    campaigns: [
      { id: "r1", name: "Reports bounces", tags: ["mixed", "whole"] },
      { id: "r2", name: "No bounce count", tags: ["mixed"] },
      { id: "r3", name: "No counts at all", tags: ["mixed"] },
    ],
    stats: [
      row("r1", "2026-11-02", {
        bounced: 10,
        contacted: 1000,
        replied: 50,
        sent: 1000,
      }),
      // Sends and replies, but no bounce count.
      row("r2", "2026-11-03", { contacted: 300, replied: 30, sent: 300 }),
    ],
  }).insights.tagRollup(NOVEMBER, { now: NOW });

  const mixed = result.data.tags.find((each) => each.tag === "mixed");
  const whole = result.data.tags.find((each) => each.tag === "whole");

  // The counts are every campaign's: 1,300 sends and 10 bounces.
  assert.deepEqual(
    [mixed?.campaigns, mixed?.sent, mixed?.bounced],
    [3, 1300, 10]
  );
  // The bounce rate is 10 of the 1,000 sends of the campaign that reports
  // bounces: 1%, the same as that campaign alone. 10 of 1,300 would be 0.77%.
  assert.deepEqual(mixed?.bounceRate, {
    count: 10,
    high: 0.0183,
    low: 0.0054,
    of: 1000,
    rate: 0.01,
  });
  assert.deepEqual(whole?.bounceRate, mixed?.bounceRate);
  // Both campaigns with counts report replies, so that rate covers both.
  assert.deepEqual(
    [mixed?.replyRate.count, mixed?.replyRate.of, mixed?.replyRate.rate],
    [80, 1300, 0.0615]
  );
  // r3 reports nothing, so it is left out of nothing: 1 of 2, not 1 of 3.
  assert.deepEqual(result.meta.notes, [
    "Tag mixed: bounce rate (1 of 2) counts only the campaigns that report both the count and what it is divided by. The others are left out of the rate, not counted as 0.",
  ]);
});

test("tag_rollup is Unsupported, before any request, on a tool whose campaigns carry no tags (OUT-57)", async () => {
  // As HeyReach: campaigns have no tags, so every one would be untagged.
  const untagged = createOutbound({
    adapter: memory({
      data: DATA,
      fields: { campaign: { tags: false } },
      workspaceId: "agency",
    }),
    plugins: [insights()],
  });

  await assert.rejects(
    untagged.insights.tagRollup({}, { now: NOW }),
    (error) =>
      OutboundError.is(error) &&
      error.code === "Unsupported" &&
      error.message ===
        "tag_rollup is not available: the memory adapter does not report campaign tags"
  );
  assert.deepEqual(
    insightTools(untagged, { only: ["tag_rollup", "campaign_ranking"] }).map(
      (tool) => tool.name
    ),
    ["campaign_ranking"]
  );

  // With a tool that has tags beside it, the campaigns that carry tags are grouped.
  const mixed = createOutbound({
    adapter: combine([
      memory({ data: DATA, name: "mailtool", workspaceId: "agency" }),
      memory({
        data: { campaigns: [{ channel: "linkedin", id: "k1" }] },
        fields: { campaign: { tags: false } },
        name: "lntool",
        workspaceId: "agency",
      }),
    ]),
    plugins: [insights()],
  });

  const result = await mixed.insights.tagRollup({ min_sent: 0 }, { now: NOW });

  assert.ok(result.data.tags.some((tag) => tag.tag === "client-a"));
});
