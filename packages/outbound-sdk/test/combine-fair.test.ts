// A combined instance over a big email tool and a small LinkedIn tool, in the
// shape the 2026-11-16 stress test met live (OUT-123, OUT-126): Instantly with
// 110 campaigns, HeyReach with 18 (10 drafts, 8 completed) and no step stats.

import assert from "node:assert/strict";
import { test } from "node:test";

import { run } from "../src/cli/index.ts";
import { combine } from "../src/combine/index.ts";
import { createOutbound, OutboundError } from "../src/index.ts";
import type { Adapter } from "../src/index.ts";
import { insights } from "../src/insights/index.ts";
import { memory } from "../src/memory/index.ts";
import type {
  MemoryCampaign,
  MemoryMessage,
  MemoryStats,
} from "../src/memory/index.ts";

const uuid = (index: number): string =>
  `00000000-0000-4000-8000-${String(index).padStart(12, "0")}`;

const STATUSES = ["active", "paused", "completed"] as const;

const EMAIL_CAMPAIGNS: MemoryCampaign[] = Array.from(
  { length: 110 },
  (_, index) => ({
    id: uuid(index + 1),
    name: index === 41 ? "Navatic" : `Email campaign ${index + 1}`,
    status: STATUSES[index % 3] ?? "active",
    steps: [
      { delayDays: 0, variants: [{ body: "Hello", subject: "Hi" }] },
      { delayDays: 3, variants: [{ body: "Bump", subject: "Re: Hi" }] },
    ],
  })
);

// Campaign totals, then the same sends by step.
const EMAIL_STATS: MemoryStats[] = EMAIL_CAMPAIGNS.flatMap((campaign) => [
  {
    campaignId: campaign.id,
    counts: { contacted: 100, replied: 3, sent: 180 },
    date: "2026-11-03",
  },
  {
    campaignId: campaign.id,
    counts: { contacted: 100, replied: 2, sent: 100 },
    date: "2026-11-03",
    stepIndex: 0,
  },
  {
    campaignId: campaign.id,
    counts: { contacted: 0, replied: 1, sent: 80 },
    date: "2026-11-06",
    stepIndex: 1,
  },
]);

// Newest first, as the vendor lists them: 60 replies, an hour apart, since 2026-11-10.
const EMAIL_REPLIES: MemoryMessage[] = Array.from(
  { length: 60 },
  (_, index) => ({
    campaignId: uuid(1),
    direction: "in",
    id: `r${index + 1}`,
    sentAt: new Date(
      Date.UTC(2026, 10, 15, 12) - index * 3_600_000
    ).toISOString(),
  })
);

const LINKEDIN_CAMPAIGNS: MemoryCampaign[] = Array.from(
  { length: 18 },
  (_, index) => ({
    channel: "linkedin",
    id: String(300_000 + index),
    name: index === 0 ? "Seats outreach" : `LinkedIn campaign ${index + 1}`,
    status: index < 10 ? "draft" : "completed",
  })
);

const instantlyLike = (): Adapter =>
  memory({
    data: {
      campaigns: EMAIL_CAMPAIGNS,
      messages: EMAIL_REPLIES,
      stats: EMAIL_STATS,
    },
    name: "instantly",
    pageSize: 100,
    workspaceId: "default",
  });

const heyreachLike = (): Adapter =>
  memory({
    capabilities: { "stats.byStep": false },
    data: {
      campaigns: LINKEDIN_CAMPAIGNS,
      messages: [
        {
          campaignId: "300010",
          direction: "in",
          id: "h1",
          sentAt: "2026-11-15T11:30:00.000Z",
        },
        {
          campaignId: "300010",
          direction: "in",
          id: "h2",
          sentAt: "2026-11-12T08:00:00.000Z",
        },
      ],
      stats: [
        {
          campaignId: "300010",
          counts: {
            connectionsAccepted: 40,
            connectionsSent: 100,
            contacted: 110,
            replied: 22,
            sent: 110,
          },
          date: "2026-11-04",
        },
      ],
    },
    name: "heyreach",
    pageSize: 100,
    workspaceId: "default",
  });

const pair = () =>
  createOutbound({
    adapter: combine([instantlyLike(), heyreachLike()]),
    plugins: [insights()],
  });

const NOVEMBER = { from: "2026-11-01", to: "2026-11-30" };

// Every state the tools have campaigns in, read 25 at most, so the email
// tool alone holds more campaigns than the cap.
const WIDE = {
  ...NOVEMBER,
  max_campaigns: 25,
  statuses: ["active" as const, "paused" as const, "completed" as const],
};

const cli = async (...argv: string[]) => {
  const out: string[] = [];
  const err: string[] = [];

  const code = await run([...argv, "--compact"], {
    adapter: combine([instantlyLike(), heyreachLike()]),
    stderr: (text) => {
      err.push(text);
    },
    stdout: (text) => {
      out.push(text);
    },
  });

  return { code, text: out.join("") || err.join("") };
};

const dataOf = <Data>(text: string): Data =>
  (JSON.parse(text) as { data: Data }).data;

test("channel_mix compares email and LinkedIn although the email tool has more campaigns than max_campaigns", async () => {
  const { data, meta } = await pair().insights.channelMix(WIDE);

  assert.deepEqual(
    data.channels.map((group) => [group.channel, group.campaigns]),
    [
      ["email", 17],
      ["linkedin", 8],
    ],
    "the LinkedIn tool keeps its 8 completed campaigns, the email tool takes the rest"
  );
  assert.equal(data.campaignsRead, 25);
  assert.equal(data.moreCampaignsExist, true);
  assert.notEqual(data.comparison, null);
  assert.doesNotMatch(data.finding, /Only email/u);
  assert.equal(meta.complete, false);
  assert.ok(
    meta.notes.includes(
      "max_campaigns is shared among the tools: instantly:default 17, heyreach:default 8."
    ),
    meta.notes.join(" | ")
  );
});

test("max_campaigns is split evenly between tools that both have more than their share", async () => {
  const { data } = await pair().insights.channelMix({
    ...WIDE,
    statuses: ["completed", "draft"],
  });

  // 36 email and 18 LinkedIn campaigns are completed or drafts: 25 is split 13 and 12.
  assert.deepEqual(
    data.channels.map((group) => [group.channel, group.campaigns]),
    [
      ["email", 13],
      ["linkedin", 12],
    ]
  );
});

test("a combined instance with no campaign in the default state says it checked nothing", async () => {
  const { data, meta } = await createOutbound({
    adapter: combine([heyreachLike()]),
    plugins: [insights()],
  }).insights.channelMix(NOVEMBER);

  assert.equal(data.campaignsRead, 0);
  assert.equal(meta.complete, false);
  assert.ok(
    meta.notes.includes(
      "No campaign is active, so nothing was checked (18 campaigns: 8 completed, 10 draft). Pass statuses to check the others."
    ),
    meta.notes.join(" | ")
  );
});

test("channel_mix never says a channel is absent when max_campaigns left campaigns unread", async () => {
  const { data } = await createOutbound({
    adapter: combine([instantlyLike()]),
    plugins: [insights()],
  }).insights.channelMix({ ...NOVEMBER, max_campaigns: 3 });

  assert.equal(data.comparison, null);
  assert.match(
    data.finding,
    /^Only email campaigns were read before max_campaigns stopped the read/u
  );
});

test("campaign_ranking on the combined instance includes the LinkedIn campaign", async () => {
  const { data } = await pair().insights.campaignRanking(WIDE);

  assert.match(JSON.stringify(data), /heyreach:default:300010/u);
});

test("a campaign listing capped below one tool's size still holds every tool", async () => {
  const campaigns = await pair().campaigns.listAll({ max: 10 }).toArray();

  assert.deepEqual(
    [...new Set(campaigns.map((campaign) => campaign.provider))],
    ["instantly", "heyreach"]
  );
});

test("replies --since on the combined instance lists both tools newest first", async () => {
  const { code, text } = await cli(
    "replies",
    "--since",
    "2026-11-10T00:00:00.000Z",
    "--limit",
    "5"
  );

  assert.equal(code, 0, text);
  assert.deepEqual(
    dataOf<{ items: { ref: string }[] }>(text).items.map((reply) => reply.ref),
    [
      "instantly:default:r1",
      "heyreach:default:h1",
      "instantly:default:r2",
      "instantly:default:r3",
      "instantly:default:r4",
    ]
  );
});

test("a campaign name resolves across every tool of the combined instance", async () => {
  const named = await cli("campaign", "Navatic");

  assert.equal(named.code, 0, named.text);
  assert.equal(
    dataOf<{ ref: string }>(named.text).ref,
    `instantly:default:${uuid(42)}`
  );

  const linkedin = await cli("campaign", "seats outreach");
  assert.equal(linkedin.code, 0, linkedin.text);
  assert.equal(
    dataOf<{ ref: string }>(linkedin.text).ref,
    "heyreach:default:300000"
  );

  const bare = await cli("campaign", "300000");
  assert.equal(bare.code, 0, bare.text);
  assert.equal(
    dataOf<{ ref: string }>(bare.text).ref,
    "heyreach:default:300000"
  );

  const ambiguous = await cli("campaign", "campaign 1");
  assert.notEqual(ambiguous.code, 0);
  assert.match(ambiguous.text, /match \\"campaign 1\\"/u);
  assert.match(ambiguous.text, /instantly:default:/u);
  assert.match(ambiguous.text, /heyreach:default:/u);
});

test("step_funnel runs for an Instantly ref and is refused for a HeyReach ref, naming heyreach", async () => {
  const outbound = pair();

  const funnel = await outbound.insights.stepFunnel({
    campaign: `instantly:default:${uuid(1)}`,
  });

  assert.deepEqual(
    funnel.data.steps.map((step) => [step.step, step.sent, step.replies]),
    [
      [0, 100, 2],
      [1, 80, 1],
    ]
  );

  await assert.rejects(
    () => outbound.insights.stepFunnel({ campaign: "heyreach:default:300010" }),
    (error: unknown) =>
      OutboundError.is(error) &&
      error.code === "Unsupported" &&
      error.provider === "heyreach" &&
      /the heyreach adapter does not support stats\.byStep/u.test(error.message)
  );
});

test("step_funnel takes a campaign name on the combined instance and checks the tool it names", async () => {
  const named = await cli(
    "insight",
    "step_funnel",
    "--input",
    JSON.stringify({ campaign: "Navatic" })
  );

  assert.equal(named.code, 0, named.text);

  const refused = await cli(
    "insight",
    "step_funnel",
    "--input",
    JSON.stringify({ campaign: "Seats outreach" })
  );

  assert.notEqual(refused.code, 0);
  assert.match(
    refused.text,
    /heyreach adapter does not support stats\.byStep/u
  );
});

test("a capped reply listing keeps exactly the newest, even past one tool's first page", async () => {
  // 110 recent email replies in pages of 100; the LinkedIn tool's two are older.
  const recent: MemoryMessage[] = Array.from({ length: 110 }, (_, index) => ({
    campaignId: uuid(1),
    direction: "in",
    id: `n${index + 1}`,
    sentAt: new Date(Date.UTC(2026, 10, 16, 12) - index * 60_000).toISOString(),
  }));

  const outbound = createOutbound({
    adapter: combine([
      memory({
        data: { campaigns: EMAIL_CAMPAIGNS, messages: recent },
        name: "instantly",
        pageSize: 100,
        workspaceId: "default",
      }),
      heyreachLike(),
    ]),
  });

  const capped = await outbound.replies.listAll({ max: 101 }).toArray();

  assert.deepEqual(
    capped.map((reply) => reply.ref),
    recent.slice(0, 101).map((reply) => `instantly:default:${reply.id}`)
  );

  // Page by page, time never jumps forward, and every reply comes once.
  const seen: string[] = [];
  let cursor: string | undefined;

  do {
    // oxlint-disable-next-line no-await-in-loop -- each page needs the previous page's cursor.
    const page = await outbound.replies.list({ cursor });
    seen.push(...page.items.map((reply) => reply.sentAt ?? ""));
    ({ cursor } = page);
  } while (cursor !== undefined);

  assert.equal(seen.length, 112);
  assert.deepEqual(seen, seen.toSorted().toReversed());
});

test("a tool whose page is not in time order still moves on to its next page", async () => {
  // Seen live on 2026-11-17: replies --provider all with no --since re-read
  // one Instantly page for over 15 minutes, because the page held a reply
  // older than its last one. HeyReach's pages are never in time order: a
  // page of conversations lists each one's messages oldest first.
  const hours = [10, 5, 8, 4, 2, 3];

  const shuffled: MemoryMessage[] = hours.map((hour, index) => ({
    campaignId: uuid(1),
    direction: "in",
    id: `s${index + 1}`,
    sentAt: new Date(Date.UTC(2026, 10, 16, hour)).toISOString(),
  }));

  const outbound = createOutbound({
    adapter: combine([
      memory({
        data: { campaigns: EMAIL_CAMPAIGNS, messages: shuffled },
        name: "instantly",
        pageSize: 3,
        workspaceId: "default",
      }),
      heyreachLike(),
    ]),
  });

  const seen: string[] = [];
  let cursor: string | undefined;
  let pages = 0;

  do {
    // oxlint-disable-next-line no-await-in-loop -- each page needs the previous page's cursor.
    const page = await outbound.replies.list({ cursor });
    seen.push(...page.items.map((reply) => reply.ref));
    ({ cursor } = page);
    pages += 1;
  } while (cursor !== undefined && pages < 20);

  assert.equal(cursor, undefined, "the walk ends");
  assert.equal(seen.length, 8, "six email replies and two LinkedIn ones");
  assert.equal(new Set(seen).size, 8, "each once");
});

test("a campaign name is not looked up when no tool can serve the insight", async () => {
  // Neither tool reports by step. The name matches nothing, so a lookup would
  // end in NotFound; the refusal comes first.
  const outbound = createOutbound({
    adapter: combine([
      heyreachLike(),
      memory({
        capabilities: { "stats.byStep": false },
        data: { campaigns: LINKEDIN_CAMPAIGNS },
        name: "lntool",
        workspaceId: "other",
      }),
    ]),
    plugins: [insights()],
  });

  await assert.rejects(
    () => outbound.insights.stepFunnel({ campaign: "No such campaign" }),
    (error: unknown) =>
      OutboundError.is(error) &&
      error.code === "Unsupported" &&
      /stats\.byStep/u.test(error.message)
  );
});

test("a reply that arrives between two pages neither repeats nor drops one", async () => {
  // The email tool lists 100 recent replies with more to come; the LinkedIn
  // tool's ten straddle them, so its older ones wait for the next page.
  const email: MemoryMessage[] = Array.from({ length: 150 }, (_, index) => ({
    campaignId: uuid(1),
    direction: "in",
    id: `e${index + 1}`,
    sentAt: new Date(Date.UTC(2026, 10, 16, 12) - index * 60_000).toISOString(),
  }));

  const linkedin: MemoryMessage[] = Array.from({ length: 10 }, (_, index) => ({
    campaignId: "300010",
    direction: "in",
    id: `k${index + 1}`,
    sentAt: new Date(
      Date.UTC(2026, 10, 16, 12) - index * 1_200_000 - 30_000
    ).toISOString(),
  }));

  const messages = [...linkedin];

  const outbound = createOutbound({
    adapter: combine([
      memory({
        data: { campaigns: EMAIL_CAMPAIGNS, messages: email },
        name: "instantly",
        pageSize: 100,
        workspaceId: "default",
      }),
      memory({
        data: { campaigns: LINKEDIN_CAMPAIGNS, messages },
        name: "heyreach",
        pageSize: 100,
        workspaceId: "default",
      }),
    ]),
  });

  const first = await outbound.replies.list();
  assert.ok(first.cursor !== undefined);

  // A new LinkedIn reply lands at the top before the next page is read.
  messages.unshift({
    campaignId: "300010",
    direction: "in",
    id: "k0",
    sentAt: "2026-11-16T12:30:00.000Z",
  });

  const refs: string[] = first.items.map((reply) => reply.ref);
  let cursor: string | undefined = first.cursor;

  while (cursor !== undefined) {
    // oxlint-disable-next-line no-await-in-loop -- each page needs the previous page's cursor.
    const page = await outbound.replies.list({ cursor });
    refs.push(...page.items.map((reply) => reply.ref));
    ({ cursor } = page);
  }

  assert.equal(new Set(refs).size, refs.length, "no reply repeats");
  assert.equal(refs.length, 160, "every reply listed at the start comes once");
});

const at = (minute: number) =>
  new Date(Date.UTC(2026, 10, 16, 12, minute)).toISOString();

test("a reply given out and then deleted between pages makes none repeat or go missing", async () => {
  // g and b share a minute and are given out together; then b, the last
  // given out, is deleted, so the next page resumes by time and lists c once.

  const email: MemoryMessage[] = [
    { campaignId: uuid(1), direction: "in", id: "a", sentAt: at(50) },
    { campaignId: uuid(1), direction: "in", id: "g", sentAt: at(30) },
    { campaignId: uuid(1), direction: "in", id: "b", sentAt: at(30) },
    { campaignId: uuid(1), direction: "in", id: "c", sentAt: at(10) },
  ];

  const later: MemoryMessage[] = Array.from({ length: 3 }, (_, index) => ({
    campaignId: "300010",
    direction: "in",
    id: `k${index + 1}`,
    sentAt: at(40 - index * 10),
  }));

  const outbound = createOutbound({
    adapter: combine([
      memory({
        data: { campaigns: EMAIL_CAMPAIGNS, messages: email },
        name: "instantly",
        pageSize: 100,
        workspaceId: "default",
      }),
      memory({
        data: { campaigns: LINKEDIN_CAMPAIGNS, messages: later },
        name: "heyreach",
        pageSize: 2,
        workspaceId: "default",
      }),
    ]),
  });

  const first = await outbound.replies.list();
  const given = first.items.map((reply) => reply.ref);
  assert.ok(given.includes("instantly:default:b"), given.join(", "));
  assert.ok(!given.includes("instantly:default:c"), given.join(", "));

  // b is the last one given out, so the next page cannot find it.
  email.splice(2, 1);

  const refs = [...given];
  let cursor: string | undefined = first.cursor;

  while (cursor !== undefined) {
    // oxlint-disable-next-line no-await-in-loop -- each page needs the previous page's cursor.
    const page = await outbound.replies.list({ cursor });
    refs.push(...page.items.map((reply) => reply.ref));
    ({ cursor } = page);
  }

  assert.deepEqual(refs.toSorted(), [
    "heyreach:default:k1",
    "heyreach:default:k2",
    "heyreach:default:k3",
    "instantly:default:a",
    "instantly:default:b",
    "instantly:default:c",
    "instantly:default:g",
  ]);
});
