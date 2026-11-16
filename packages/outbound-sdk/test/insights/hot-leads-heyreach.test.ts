// hot_leads on HeyReach (OUT-125). A HeyReach lead record carries no reply
// count and a campaign's leads carry no auto-tag, so every replied lead used
// to score a flat 10, in ref order. The conversations hold both: message
// times give recency and a count, and the correspondent's auto-tag gives the
// interest class.

import assert from "node:assert/strict";
import { test } from "node:test";

import { createOutbound, MemoryRateLimitStore } from "../../src/index.ts";
import { insights } from "../../src/insights/index.ts";
import { fixtureHandler } from "../helpers/adapter-suite.ts";
import { createClock } from "../helpers/clock.ts";
import { fixture } from "../helpers/fixtures.ts";
import { createFetch, json } from "../helpers/http.ts";
import { suite as heyreach } from "../heyreach/suite.ts";

type Raw = Record<string, unknown>;

const NOW = Date.parse("2026-11-16T12:00:00.000Z");
const DAY = 86_400_000;

const ago = (days: number): string => new Date(NOW - days * DAY).toISOString();

const [template] = (
  fixture("heyreach", "getConversations.json") as { items: Raw[] }
).items;

const profile = (slug: string, tags: readonly string[]): Raw => ({
  ...(template?.correspondentProfile as Raw),
  autoTags: tags.map((name) => ({
    campaignId: 274_079,
    creationTime: ago(20),
    name,
  })),
  profileUrl: `https://www.linkedin.com/in/${slug}`,
});

const conversation = (
  slug: string,
  tags: readonly string[],
  replies: readonly number[]
): Raw => ({
  ...template,
  correspondentProfile: profile(slug, tags),
  id: `2-${slug}==`,
  lastMessageAt: ago(Math.min(...replies)),
  messages: [
    { body: "Hi, thanks for connecting.", createdAt: ago(30), sender: "ME" },
    ...replies.map((days) => ({
      body: "Happy to chat.",
      createdAt: ago(days),
      sender: "CORRESPONDENT",
    })),
  ],
});

// Interested, replied 2 days ago; Interested, replied 10 and 12 days ago;
// no tag, replied yesterday.
const CONVERSATIONS = [
  conversation("example-person-3", [], [1]),
  conversation("example-person-1", ["Interested"], [2]),
  conversation("example-person-2", ["Interested"], [10, 12]),
];

const run = async (input: { positive_labels?: string[] } = {}) => {
  const clock = createClock();
  const unrouted: string[] = [];
  const fixtures = fixtureHandler([heyreach], unrouted);

  const http = createFetch((request, index) =>
    new URL(request.url).pathname === "/api/public/inbox/GetConversationsV3"
      ? json({
          hasNextPage: false,
          items: CONVERSATIONS,
          nextCursor: null,
          totalCount: CONVERSATIONS.length,
        })
      : fixtures(request, index)
  );

  const outbound = createOutbound({
    adapter: heyreach.make(),
    fetch: http.fetch,
    plugins: [insights()],
    rateLimitStore: new MemoryRateLimitStore(),
    runtime: clock.runtime,
    share: 1,
  });

  const result = await clock.settle(
    outbound.insights.hotLeads(input, { now: NOW })
  );

  return { result, unrouted };
};

test("hot_leads on HeyReach ranks by recency and the Interested tag, the most recent Interested reply first", async () => {
  const { result, unrouted } = await run();

  assert.deepEqual(unrouted, []);
  assert.deepEqual(
    result.data.leads.map((each) => [each.lead.split("/").at(-1), each.score]),
    [
      // 50 for the tag, 10 for one reply, 20 x (1 - 2/14) for its recency.
      ["example-person-1", 77.1429],
      // 50, 2 x 10, 20 x (1 - 10/14).
      ["example-person-2", 75.7143],
      // No tag: 10 and 20 x (1 - 1/14).
      ["example-person-3", 28.5714],
    ]
  );
  assert.equal(
    result.data.leads[0]?.reason,
    "marked positive by the vendor, replied 1 time, last reply 2 days ago."
  );
});

test("hot_leads on HeyReach does not say the vendor reports no reply data when it read replies", async () => {
  const { result } = await run();

  assert.ok(
    result.meta.notes.every((note) => !/reply counts?,/u.test(note)),
    result.meta.notes.join(" ")
  );
  assert.ok(
    result.meta.notes.includes(
      "This tool reports no per-lead open or click counts, so those are unknown, and reply counts and recency come from the replies read within recency_days."
    ),
    result.meta.notes.join(" ")
  );
});

test("hot_leads on HeyReach gives an Interested tag no points when positive_labels leaves Interested out", async () => {
  const { result } = await run({ positive_labels: ["Meeting Booked"] });

  assert.deepEqual(
    result.data.leads.map((each) => [each.lead.split("/").at(-1), each.score]),
    [
      ["example-person-3", 28.5714],
      ["example-person-1", 27.1429],
      ["example-person-2", 25.7143],
    ]
  );
});
