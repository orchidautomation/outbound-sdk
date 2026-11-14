import assert from "node:assert/strict";
import { test } from "node:test";

import { combine } from "../../src/combine/index.ts";
import { createOutbound, OutboundError } from "../../src/index.ts";
import { insights } from "../../src/insights/index.ts";
import { memory } from "../../src/memory/index.ts";
import type { MemoryData } from "../../src/memory/index.ts";
import { must, ref, toolWithRows, withRows } from "./copy-helpers.ts";
import type { StepRow } from "./copy-helpers.ts";
import { NOW, single } from "./helpers.ts";

const X = { body: "Body X", subject: "Quick question" };
const Y = { body: "Body Y", subject: "Another idea" };
const Z = { body: "Body Z, the follow-up", subject: "" };
const W = { body: "Body W", subject: "Draft only" };

const DATA: MemoryData = {
  campaigns: [
    {
      id: "c1",
      name: "Founders",
      steps: [{ variants: [X] }, { variants: [Z] }],
    },
    // X runs against Y here, so the step's counts must come per variant.
    {
      id: "c2",
      name: "Agencies",
      status: "paused",
      steps: [{ variants: [X, Y] }],
    },
    {
      id: "c3",
      name: "Retail",
      status: "completed",
      steps: [{ variants: [Z] }, { variants: [X] }],
    },
    {
      id: "c4",
      name: "Not started",
      status: "draft",
      steps: [{ variants: [W, X] }],
    },
  ],
};

const ROWS: readonly StepRow[] = [
  { campaignId: "c1", counts: { replied: 60, sent: 1000 }, step: 0 },
  { campaignId: "c1", counts: { replied: 12, sent: 400 }, step: 1 },
  {
    campaignId: "c2",
    counts: { replied: 20, sent: 1000 },
    step: 0,
    variant: "A",
  },
  {
    campaignId: "c2",
    counts: { replied: 30, sent: 500 },
    step: 0,
    variant: "B",
  },
  { campaignId: "c3", counts: { replied: 3, sent: 40 }, step: 0 },
  { campaignId: "c3", counts: { replied: 30, sent: 1000 }, step: 1 },
];

test("copy_reuse compares the same copy across campaigns and names the best copy", async () => {
  const outbound = withRows(DATA, ROWS);
  const result = await outbound.insights.copyReuse({}, { now: NOW });
  const x = must(result.data.reused[0]);
  const z = must(result.data.reused[1]);
  const best = must(result.data.bestCopy);

  assert.equal(result.insight, "copy_reuse");
  assert.equal(result.meta.complete, true);
  // The draft campaign is not read by default: X, Z and Y remain.
  assert.deepEqual(
    [
      result.data.campaignsRead,
      result.data.piecesOfCopy,
      result.data.reused.length,
      result.data.variantsWithoutStats,
    ],
    [3, 3, 2, 0]
  );

  const hash = (await outbound.campaign(ref("c1")).sequence()).steps[0]
    ?.variants[0]?.contentHash;

  // X: 60 + 30 + 20 = 110 replies of 1000 + 1000 + 1000 sends = 0.0367.
  assert.deepEqual(
    [
      x.contentHash,
      x.subject,
      x.bodyPreview,
      x.campaigns,
      x.sent,
      x.replies,
      x.trials,
      x.replyRate,
      x.replyRateInterval,
    ],
    [
      hash,
      "Quick question",
      "Body X",
      3,
      3000,
      110,
      3000,
      0.0367,
      { high: 0.044, low: 0.0305 },
    ]
  );
  // Best campaign first.
  assert.deepEqual(
    x.uses.map((use) => [
      use.campaign,
      use.campaignName,
      use.provider,
      use.places,
      use.sent,
      use.replies,
      use.replyRate,
    ]),
    [
      [ref("c1"), "Founders", "memory", ["0:A"], 1000, 60, 0.06],
      [ref("c3"), "Retail", "memory", ["1:A"], 1000, 30, 0.03],
      [ref("c2"), "Agencies", "memory", ["0:A"], 1000, 20, 0.02],
    ]
  );
  assert.deepEqual(x.uses[0]?.replyRateInterval, {
    high: 0.0765,
    low: 0.0469,
  });
  // 0.06 - 0.02; 60/1000 against 20/1000 is z = 4.5644, p rounds to 0.
  assert.deepEqual(
    [x.spread, x.best, x.worst, x.spreadPValue, x.spreadIsReal],
    [0.04, ref("c1"), ref("c2"), 0, true]
  );
  assert.equal(
    x.finding,
    "The same copy gets 0.06 in Founders and 0.02 in Agencies; the gap is more than chance, so the audience or the sender differs, not the copy."
  );

  // Z: 3/40 in Retail is under the 100 needed, so one campaign is left and no spread is judged.
  assert.deepEqual(
    [z.subject, z.sent, z.replies, z.replyRate, z.replyRateInterval],
    // 12 + 3 = 15 replies of 400 + 40 = 440 sends = 0.0341.
    ["", 440, 15, 0.0341, { high: 0.0555, low: 0.0208 }]
  );
  assert.deepEqual(
    z.uses.map((use) => [use.campaign, use.replyRate, use.trials]),
    [
      [ref("c3"), 0.075, 40],
      [ref("c1"), 0.03, 400],
    ]
  );
  assert.deepEqual(
    [z.spread, z.best, z.worst, z.spreadPValue, z.spreadIsReal],
    [null, null, null, null, null]
  );
  assert.match(z.finding, /Fewer than two campaigns have a base of 100/u);

  // Y runs in one campaign only, and has the highest pooled rate: 30 / 500 = 0.06.
  assert.deepEqual(
    [
      best.subject,
      best.campaigns,
      best.sent,
      best.replies,
      best.replyRate,
      best.replyRateInterval,
    ],
    ["Another idea", 1, 500, 30, 0.06, { high: 0.0844, low: 0.0423 }]
  );
});

test("copy_reuse moves the spread and the best copy with min_sent, and the campaigns with statuses", async () => {
  const outbound = withRows(DATA, ROWS);

  // At 40, Retail's 3/40 counts: Z spreads 0.075 - 0.03 = 0.045, wider than X's 0.04.
  const small = await outbound.insights.copyReuse(
    { min_sent: 40 },
    { now: NOW }
  );

  assert.deepEqual(
    small.data.reused.map((piece) => [
      piece.subject,
      piece.spread,
      piece.spreadPValue,
      piece.spreadIsReal,
    ]),
    [
      // 3/40 against 12/400: z = 1.4954, p = 0.1348.
      ["", 0.045, 0.1348, false],
      ["Quick question", 0.04, 0, true],
    ]
  );
  assert.match(small.data.reused[0]?.finding ?? "", /could be chance/u);

  // At 600 only X (3000 sends) is big enough to be named.
  const large = await outbound.insights.copyReuse(
    { min_sent: 600 },
    { now: NOW }
  );

  assert.equal(large.data.bestCopy?.subject, "Quick question");

  // At 5000 nothing is.
  const huge = await outbound.insights.copyReuse(
    { min_sent: 5000 },
    { now: NOW }
  );

  assert.equal(huge.data.bestCopy, null);
  assert.deepEqual(
    huge.data.reused.map((piece) => piece.spread),
    [null, null]
  );

  // With drafts read too, X is in a fourth campaign, where it has no numbers yet.
  const drafts = await outbound.insights.copyReuse(
    { statuses: ["active", "paused", "completed", "draft"] },
    { now: NOW }
  );

  const [x] = drafts.data.reused;

  assert.deepEqual(
    [drafts.data.campaignsRead, drafts.data.piecesOfCopy, x?.campaigns],
    [4, 4, 4]
  );
  assert.deepEqual(x?.uses.at(-1), {
    campaign: ref("c4"),
    campaignName: "Not started",
    places: ["0:B"],
    provider: "memory",
    replies: null,
    replyRate: null,
    replyRateInterval: null,
    sent: null,
    trials: null,
  });
  // The unknown campaign does not change the pooled rate.
  assert.deepEqual([x?.sent, x?.replies, x?.replyRate], [3000, 110, 0.0367]);
  assert.equal(drafts.data.variantsWithoutStats, 2);

  const onlyDrafts = await outbound.insights.copyReuse(
    { statuses: ["draft"] },
    { now: NOW }
  );

  assert.deepEqual(
    [
      onlyDrafts.data.campaignsRead,
      onlyDrafts.data.reused,
      onlyDrafts.data.bestCopy,
    ],
    [1, [], null]
  );
});

test("copy_reuse leaves counts unknown when the vendor reports a split step as a whole, or no replies", async () => {
  const result = await single({
    campaigns: [
      // Two variants, one step-level row: neither variant can be given the step's numbers.
      { id: "c1", steps: [{ variants: [X, Y] }] },
      // Sends known, replies not.
      { id: "c2", steps: [{ variants: [X] }] },
      // X twice in one campaign, plus a variant with no text at all.
      {
        id: "c3",
        steps: [{ variants: [X] }, { variants: [{}] }, { variants: [X] }],
      },
    ],
    stats: [
      {
        campaignId: "c1",
        counts: { replied: 9, sent: 300 },
        date: "2026-11-01",
        stepIndex: 0,
      },
      {
        campaignId: "c2",
        counts: { sent: 500 },
        date: "2026-11-01",
        stepIndex: 0,
      },
      {
        campaignId: "c3",
        counts: { replied: 8, sent: 200 },
        date: "2026-11-01",
        stepIndex: 0,
      },
      {
        campaignId: "c3",
        counts: { replied: 2, sent: 200 },
        date: "2026-11-01",
        stepIndex: 2,
      },
    ],
  }).insights.copyReuse({}, { now: NOW });

  const [x] = result.data.reused;

  assert.equal(result.data.reused.length, 1);
  assert.equal(result.data.piecesOfCopy, 2);
  assert.deepEqual(
    x?.uses.map((use) => [
      use.campaign,
      use.places,
      use.sent,
      use.replies,
      use.trials,
      use.replyRate,
    ]),
    [
      // 8 + 2 replies of 200 + 200 sends.
      [ref("c3"), ["0:A", "2:A"], 400, 10, 400, 0.025],
      [ref("c1"), ["0:A"], null, null, null, null],
      // 500 sends with no reply count: the rate is unknown, not 0.
      [ref("c2"), ["0:A"], 500, null, null, null],
    ]
  );
  // The pooled rate rests on the one campaign with both counts: 10 / 400.
  assert.deepEqual(
    [x?.sent, x?.replies, x?.trials, x?.replyRate],
    [900, 10, 400, 0.025]
  );
  assert.equal(result.data.variantsWithoutStats, 2);
  assert.ok(
    result.meta.notes.some((note) =>
      note.startsWith("2 variant(s) have no counts of their own")
    )
  );
});

test("copy_reuse with no campaigns returns nothing, and a cap makes the answer incomplete", async () => {
  const empty = await single({}).insights.copyReuse({}, { now: NOW });

  assert.deepEqual(empty.data, {
    bestCopy: null,
    campaignsRead: 0,
    piecesOfCopy: 0,
    reused: [],
    variantsWithoutStats: 0,
  });
  assert.equal(empty.meta.complete, true);

  const capped = await withRows(DATA, ROWS).insights.copyReuse(
    { max_campaigns: 2 },
    { now: NOW }
  );

  assert.equal(capped.data.campaignsRead, 2);
  assert.equal(capped.meta.complete, false);
  assert.deepEqual(capped.meta.notes, [
    "A listing was cut off at its cap; more records exist.",
  ]);

  // Exactly at the cap nothing is cut off.
  const exact = await withRows(DATA, ROWS).insights.copyReuse(
    { max_campaigns: 3 },
    { now: NOW }
  );

  assert.equal(exact.meta.complete, true);
});

test("copy_reuse is refused without sequences or step stats, and filters statuses itself when the tool cannot", async () => {
  for (const key of ["sequence", "stats.byStep"]) {
    await assert.rejects(
      single(DATA, { [key]: false }).insights.copyReuse({}, { now: NOW }),
      (error) =>
        error instanceof OutboundError &&
        error.code === "Unsupported" &&
        error.message.includes(key)
    );
  }

  const unfiltered = await single(DATA, {
    "campaigns.status": false,
  }).insights.copyReuse({ statuses: ["paused", "draft"] }, { now: NOW });

  // All four campaigns are listed; the two asked for are kept.
  assert.equal(unfiltered.data.campaignsRead, 2);
  assert.equal(unfiltered.data.reused[0]?.subject, "Quick question");
  assert.equal(unfiltered.meta.complete, true);
});

test("copy_reuse matches copy across tools on a combined instance", async () => {
  const outbound = createOutbound({
    adapter: combine([
      toolWithRows(DATA, ROWS, "mailtool"),
      memory({
        data: {
          campaigns: [
            { id: "c1", name: "Second tool", steps: [{ variants: [X] }] },
          ],
          stats: [
            {
              campaignId: "c1",
              counts: { replied: 12, sent: 300 },
              date: "2026-11-01",
              stepIndex: 0,
            },
          ],
        },
        name: "othertool",
        workspaceId: "agency",
      }),
    ]),
    plugins: [insights()],
  });

  const result = await outbound.insights.copyReuse({}, { now: NOW });

  const x = result.data.reused.find(
    (piece) => piece.subject === "Quick question"
  );

  assert.equal(result.data.campaignsRead, 4);
  assert.deepEqual(
    x?.uses.map((use) => [use.campaign, use.provider, use.replyRate]),
    [
      [ref("c1", "mailtool"), "mailtool", 0.06],
      // 12 / 300 in the second tool.
      [ref("c1", "othertool"), "othertool", 0.04],
      [ref("c3", "mailtool"), "mailtool", 0.03],
      [ref("c2", "mailtool"), "mailtool", 0.02],
    ]
  );
  // 110 + 12 replies of 3000 + 300 sends = 122 / 3300 = 0.037.
  assert.deepEqual([x?.sent, x?.replies, x?.replyRate], [3300, 122, 0.037]);
});
