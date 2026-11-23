// A scoped sync on HeyReach reads only its campaigns' conversations and
// says that the inbox, the conversations tied to no campaign, was left out
// with an unknown count (OUT-203). A conversation does not name its
// campaign (seen live on 2026-11-17 and 2026-11-23), so it cannot be matched.

import assert from "node:assert/strict";
import { test } from "node:test";

import { createOutbound, MemoryRateLimitStore } from "../../src/index.ts";
import type { Message } from "../../src/index.ts";
import { memory } from "../../src/memory/index.ts";
import { memoryCheckpointStore, sync } from "../../src/sync/index.ts";
import { fixtureHandler } from "../helpers/adapter-suite.ts";
import { fixture } from "../helpers/fixtures.ts";
import { createFetch, json } from "../helpers/http.ts";
import type { RecordedRequest } from "../helpers/http.ts";
import { CAMPAIGN, suite } from "./suite.ts";

const INBOX = fixture("heyreach", "getConversations.inbox.json") as {
  items: { id: string }[];
};

/** What HeyReach knows and does not say: the campaign of each conversation. */
const CAMPAIGN_OF = new Map([["2-ExampleInboxCampaign1==", Number(CAMPAIGN)]]);

interface Listing {
  readonly filters?: { readonly campaignIds?: readonly number[] };
}

const instance = () => {
  const listings: (readonly number[] | undefined)[] = [];
  const fixtures = fixtureHandler([suite], []);

  const http = createFetch((request: RecordedRequest, index) => {
    if (
      new URL(request.url).pathname !== "/api/public/inbox/GetConversationsV3"
    ) {
      return fixtures(request, index);
    }

    const campaigns = (JSON.parse(request.body ?? "{}") as Listing).filters
      ?.campaignIds;

    listings.push(campaigns);

    const items = INBOX.items.filter(
      (item) =>
        campaigns === undefined ||
        campaigns.includes(CAMPAIGN_OF.get(item.id) ?? -1)
    );

    return json({ ...INBOX, items, totalCount: items.length });
  });

  const outbound = createOutbound({
    adapter: suite.make(),
    fetch: http.fetch,
    plugins: [sync({ checkpoints: memoryCheckpointStore() })],
    rateLimitStore: new MemoryRateLimitStore(),
    retries: 0,
  });

  return { listings, outbound };
};

test("a scoped HeyReach reply sync reads its campaign only and leaves the inbox out, uncounted", async () => {
  const { listings, outbound } = instance();
  const conversations: (string | null)[] = [];

  const result = await outbound.sync.run("replies", {
    campaign_name: "Example Campaign 1",
    onPage: (items) => {
      conversations.push(
        ...items.map((item) =>
          "campaignRef" in item ? item.campaignRef : null
        )
      );
    },
  });

  assert.ok(listings.length > 0);
  assert.deepEqual(
    [...new Set(listings.map((each) => JSON.stringify(each)))],
    [JSON.stringify([Number(CAMPAIGN)])],
    "every inbox listing is filtered to the scope's campaign"
  );
  assert.ok(conversations.length > 0);
  assert.ok(
    conversations.every((ref) => ref === `heyreach:client-a:${CAMPAIGN}`)
  );
  assert.equal(result.scope?.inboxLeftOut, null);
  assert.match(
    result.notes.join(" "),
    /tied to no campaign \(HeyReach inbox conversations\) belong to no campaign scope, so they were left out\..*inboxLeftOut is null/u
  );
});

test("where nothing is tied to no campaign, a scoped sync leaves out 0 and says nothing of an inbox", async () => {
  const { outbound } = instance();

  const leads = await outbound.sync.run("leads", {
    campaign_name: "Example Campaign 1",
    onPage: () => {},
  });

  assert.equal(leads.scope?.inboxLeftOut, 0);
  assert.doesNotMatch(leads.notes.join(" "), /inbox/u);

  const tool = createOutbound({
    adapter: memory({
      data: {
        campaigns: [{ id: "c1", name: "One" }],
        messages: [
          {
            campaignId: "c1",
            direction: "in",
            id: "m1",
            sentAt: "2026-11-01T10:00:00.000Z",
          },
        ],
      },
    }),
    plugins: [sync({ checkpoints: memoryCheckpointStore() })],
  });

  assert.equal(tool.capabilities["replies.inbox"], false);

  const replies = await tool.sync.run("messages", {
    campaign_name: "One",
    onPage: () => {},
  });

  assert.equal(replies.records, 1);
  assert.equal(replies.scope?.inboxLeftOut, 0);
  assert.doesNotMatch(replies.notes.join(" "), /inbox/u);
});

test("an unscoped HeyReach reply sync says it left the inbox out, uncounted (OUT-207)", async () => {
  const { listings, outbound } = instance();

  const result = await outbound.sync.run("replies", { onPage: () => {} });

  assert.ok(listings.length > 0);
  assert.ok(
    listings.every((each) => each !== undefined),
    "replies are read per campaign, never from the whole inbox"
  );
  assert.equal(result.scope, undefined);
  assert.equal(result.inboxLeftOut, null);
  assert.match(
    result.notes.join(" "),
    /tied to no campaign \(HeyReach inbox conversations\) were left out, because sync reads replies as replies\.list does, without includeInbox\..*inboxLeftOut is null/u
  );

  const one = await outbound.sync.run("replies", {
    campaignId: CAMPAIGN,
    onPage: () => {},
  });

  assert.equal(one.inboxLeftOut, null);
  assert.match(one.notes.join(" "), /belong to no campaign scope/u);
});

test("an unscoped HeyReach message sync reads the inbox, so it leaves out 0", async () => {
  const { listings, outbound } = instance();
  const refs: (string | null)[] = [];

  const result = await outbound.sync.run<Message>("messages", {
    onPage: (items) => {
      refs.push(...items.map((item) => item.campaignRef));
    },
  });

  assert.ok(listings.includes(undefined), "the whole inbox was listed");
  assert.ok(refs.includes(null), "a conversation in no campaign came through");
  assert.equal(result.inboxLeftOut, 0);
  assert.doesNotMatch(result.notes.join(" "), /inbox/u);

  const tool = createOutbound({
    adapter: memory({ data: { campaigns: [{ id: "c1", name: "One" }] } }),
    plugins: [sync({ checkpoints: memoryCheckpointStore() })],
  });

  const replies = await tool.sync.run("replies", { onPage: () => {} });

  assert.equal(replies.inboxLeftOut, 0);
  assert.doesNotMatch(replies.notes.join(" "), /inbox/u);
});
