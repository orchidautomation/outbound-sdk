// The fields added for people and the inbox. HeyReach's documented examples
// show no auto-tag on a conversation, so those payloads are built here from
// the fixture with the three names the help center gives.

import assert from "node:assert/strict";
import { test } from "node:test";

import { harness } from "../helpers/adapter-suite.ts";
import { fixture } from "../helpers/fixtures.ts";
import { CAMPAIGN, LEAD, suite } from "./suite.ts";

interface Conversations {
  items: Record<string, unknown>[];
}

const conversations = (
  each: (index: number) => Record<string, unknown>
): Conversations => {
  const page = fixture("heyreach", "getConversations.json") as Conversations;

  return {
    ...page,
    hasNextPage: false,
    items: page.items.map((item, index) => ({
      ...item,
      ...each(index),
    })),
  } as Conversations;
};

const tagged = (name: string, creationTime: string) => ({
  campaignId: 274_079,
  creationTime,
  name,
});

test("heyreach: a reply takes the meaning of its lead's newest auto-tag and says it is the lead's", async () => {
  const profile = (
    fixture("heyreach", "getConversations.json") as Conversations
  ).items[0]?.correspondentProfile as Record<string, unknown>;

  const { outbound, settle } = harness(suite, () =>
    Response.json(
      conversations((index) => ({
        correspondentProfile: {
          ...profile,
          autoTags:
            index === 0
              ? [
                  tagged("Interested", "2026-01-01T00:00:00Z"),
                  tagged("Not Interested", "2026-02-01T00:00:00Z"),
                ]
              : [tagged("Some Future Tag", "2026-02-01T00:00:00Z")],
        },
        read: index === 0 ? false : null,
      }))
    )
  );

  const page = await settle(outbound.replies.list());
  const [first, second] = page.items;

  assert.equal(first?.category, "negative", "the newer tag wins");
  assert.equal(first?.categorySource, "lead");
  assert.equal(first?.unread, true, "the conversation is unread");
  assert.equal(
    second?.category,
    "unknown",
    "a name the help center does not list means nothing"
  );
  assert.equal(second?.categorySource, null);
  assert.equal(second?.unread, null, "no read flag is unknown, not read");
});

test("heyreach: Generic is neutral and an untagged lead's reply stays unknown", async () => {
  const profile = (
    fixture("heyreach", "getConversations.json") as Conversations
  ).items[0]?.correspondentProfile as Record<string, unknown>;

  const { outbound, settle } = harness(suite, () =>
    Response.json(
      conversations((index) => ({
        correspondentProfile: {
          ...profile,
          autoTags:
            index === 0 ? [tagged("generic", "2026-01-01T00:00:00Z")] : [],
        },
      }))
    )
  );

  const page = await settle(outbound.replies.list());
  assert.deepEqual(
    page.items.map((reply) => [
      reply.category,
      reply.categorySource,
      reply.unread,
    ]),
    [
      ["neutral", "lead", false],
      ["unknown", null, false],
    ],
    "names are matched without case, and read: true is not unread"
  );
});

test("heyreach: a lead carries its location and the company's LinkedIn page", async () => {
  const { outbound, settle } = harness(suite);
  const page = await settle(outbound.campaign(CAMPAIGN).leads.list());
  const [lead] = page.items;

  assert.equal(lead?.location, "Princetown");
  assert.equal(lead?.companyLinkedinUrl, null, "companyUrl is null here");
  assert.equal(lead?.website, null, "HeyReach reports no company website");
  assert.equal(lead?.phone, null);

  const one = await settle(outbound.leads.get(LEAD));
  assert.equal(
    one.companyLinkedinUrl,
    "https://www.linkedin.com/company/example-co",
    "companyUrl is the company's LinkedIn page"
  );
});

test("heyreach: a LinkedIn account has no mail provider and no tags", async () => {
  const { outbound, settle } = harness(suite);
  const page = await settle(outbound.senders.list());

  for (const sender of page.items) {
    assert.equal(sender.mailProvider, null);
    assert.deepEqual(sender.tags, []);
  }
});

test("heyreach: unread replies are asked for with seen, the other way round", async () => {
  const { outbound, requests, settle } = harness(suite);
  await settle(outbound.replies.list({ unread: true }));
  await settle(outbound.replies.list({ unread: false }));
  await settle(outbound.replies.list());

  assert.deepEqual(
    requests.map(
      (request) =>
        (JSON.parse(request.body ?? "{}") as { filters: { seen?: boolean } })
          .filters.seen
    ),
    [false, true, undefined],
    "seen is true for read conversations"
  );
});

test("heyreach: replies can be filtered by the category their lead's auto-tag means", async () => {
  const profile = (
    fixture("heyreach", "getConversations.json") as Conversations
  ).items[0]?.correspondentProfile as Record<string, unknown>;

  const { outbound, settle } = harness(suite, () =>
    Response.json(
      conversations((index) => ({
        correspondentProfile: {
          ...profile,
          autoTags:
            index === 0 ? [tagged("Interested", "2026-01-01T00:00:00Z")] : [],
        },
      }))
    )
  );

  assert.equal(outbound.capabilities["replies.category"], "vendor");

  const positive = await settle(
    outbound.replies.list({ category: "positive" })
  );

  assert.deepEqual(
    positive.items.map((reply) => reply.category),
    ["positive"],
    "the untagged lead's reply is left out"
  );

  const negative = await settle(
    outbound.replies.list({ category: "negative" })
  );

  assert.deepEqual(negative.items, []);
});

test("heyreach: every campaign's totals come from one request, a row each", async () => {
  const { outbound, requests, settle } = harness(suite);
  const stats = await settle(outbound.stats({ scope: "campaign" }));

  assert.equal(requests.length, 1);
  assert.equal(
    new URL(requests[0]?.url ?? "").pathname,
    "/api/public/stats/GetOverallStatsByCampaign"
  );
  assert.deepEqual(JSON.parse(requests[0]?.body ?? "{}"), {
    accountIds: [],
    campaignIds: [],
  });
  assert.deepEqual(
    stats.rows.map((row) => [
      row.scope,
      row.scopeRef,
      row.sent,
      row.replied,
      row.inmailsSent,
      row.connectionsSent,
      row.connectionsAccepted,
      row.date,
    ]),
    [
      // messagesSent 104, replies 106 + 109, inmails 107, connections 110 and 111.
      ["campaign", "heyreach:client-a:274079", 104, 215, 107, 110, 111, null],
      ["campaign", "heyreach:client-a:274080", 204, 415, 207, 210, 211, null],
    ]
  );
});

test("heyreach: every campaign by day is a row per campaign per day, in a dated range", async () => {
  const { outbound, requests, settle } = harness(suite);

  const stats = await settle(
    outbound.stats({
      by: "day",
      from: "2024-12-17",
      scope: "campaign",
      to: "2024-12-18",
    })
  );

  assert.deepEqual(JSON.parse(requests[0]?.body ?? "{}"), {
    accountIds: [],
    campaignIds: [],
    endDate: "2024-12-18T23:59:59.999Z",
    startDate: "2024-12-17T00:00:00.000Z",
  });
  assert.deepEqual(
    stats.rows.map((row) => [row.date, row.scopeRef, row.sent, row.timezone]),
    [
      ["2024-12-17", "heyreach:client-a:274079", 14, "UTC"],
      ["2024-12-17", "heyreach:client-a:274080", 34, "UTC"],
      ["2024-12-18", "heyreach:client-a:274079", 54, "UTC"],
    ]
  );
});

test("heyreach: a sender's campaigns are the campaign list narrowed by account id", async () => {
  const { outbound, requests, settle } = harness(suite);
  const page = await settle(outbound.sender("1101").campaigns.list());

  assert.equal(
    new URL(requests[0]?.url ?? "").pathname,
    "/api/public/campaign/GetAll"
  );
  assert.deepEqual(JSON.parse(requests[0]?.body ?? "{}"), {
    accountIds: [1101],
    limit: 100,
    offset: 0,
  });
  assert.ok(page.items.length > 0);

  await assert.rejects(
    async () => await settle(outbound.sender("my-seat").campaigns.list()),
    /account ids are whole numbers/u
  );
  assert.equal(requests.length, 1, "refused before any request");
});

test("heyreach: a campaign or list with no name is named by its id, never empty", async () => {
  const { outbound, settle } = harness(suite, () =>
    Response.json({ items: [{ id: 77, name: "  " }], totalCount: 1 })
  );

  assert.equal((await settle(outbound.campaigns.list())).items[0]?.name, "77");
  assert.equal((await settle(outbound.lists.list())).items[0]?.name, "77");
});

test("heyreach: a webhook says which of the SDK's event types its event becomes", async () => {
  const { outbound, settle } = harness(suite);
  const hooks = await settle(outbound.webhooks.listAll().toArray());

  assert.deepEqual(
    hooks.slice(0, 2).map((hook) => [hook.events, hook.eventTypes]),
    [
      [["CONNECTION_REQUEST_SENT"], ["linkedin.connection_sent"]],
      [["EVERY_MESSAGE_REPLY_RECEIVED"], ["linkedin.message_received"]],
    ],
    "the list names an event in upper case"
  );
});

test("heyreach: one list and one webhook are read by id, the webhook without its custom headers", async () => {
  const { outbound, requests, settle } = harness(suite);
  const list = await settle(outbound.lists.get("3457"));
  const hook = await settle(outbound.webhooks.get("123"));
  const [first, second] = requests.map((request) => new URL(request.url));

  assert.equal(first?.pathname, "/api/public/list/GetById");
  assert.equal(first?.searchParams.get("listId"), "3457");
  assert.equal(list.name, "Example List 1");
  assert.equal(list.size, 120, "totalItemsCount");

  assert.equal(second?.pathname, "/api/public/webhooks/GetWebhookById");
  assert.equal(second?.searchParams.get("webhookId"), "123");
  assert.equal(
    second?.searchParams.get("includeCustomHeaders"),
    "false",
    "custom headers can hold a secret and are never asked for"
  );
  assert.deepEqual(hook.eventTypes, ["linkedin.connection_sent"]);

  await assert.rejects(
    async () => await settle(outbound.lists.get("my-list")),
    /list ids are whole numbers/u
  );
});

test("heyreach: a campaign's lead says whether it replied, apart from where it is in the sequence", async () => {
  const page = fixture("heyreach", "getLeadsFromCampaign.json") as {
    items: Record<string, unknown>[];
  };

  const [row] = page.items;

  const cases = [
    { leadCampaignStatus: "InSequence", leadMessageStatus: "MessageSent" },
    { leadCampaignStatus: "Finished", leadMessageStatus: "MessageReply" },
    { leadCampaignStatus: "Failed", leadMessageStatus: "None" },
    { leadCampaignStatus: "Paused", leadMessageStatus: null },
  ];

  const { outbound, settle } = harness(suite, () =>
    Response.json({
      items: cases.map((each, index) => ({
        ...row,
        ...each,
        id: index + 1,
        linkedInUserProfile: {
          ...(row?.linkedInUserProfile as object),
          profileUrl: `https://www.linkedin.com/in/example-person-${index + 40}`,
        },
      })),
      totalCount: cases.length,
    })
  );

  const leads = await settle(outbound.campaign(CAMPAIGN).leads.list());
  assert.deepEqual(
    leads.items.map((each) => [
      each.status,
      each.progress,
      each.replied,
      each.bounced,
      each.unsubscribed,
    ]),
    [
      ["active", "active", false, null, null],
      ["replied", "completed", true, null, null],
      ["unknown", "unknown", false, null, null],
      ["paused", "paused", null, null, null],
    ],
    "LinkedIn has no bounce and no unsubscribe, and no message status is unknown"
  );
});

test("heyreach: a campaign's progress counts its leads by how far they got", async () => {
  const { outbound, requests, settle } = harness(suite);
  const progress = await settle(outbound.campaign(CAMPAIGN).progress());

  assert.equal(
    new URL(requests[0]?.url ?? "").pathname,
    "/api/public/campaign/GetById"
  );
  assert.deepEqual(
    {
      blocked: progress.blocked,
      completed: progress.completed,
      failed: progress.failed,
      inProgress: progress.inProgress,
      leads: progress.leads,
      notStarted: progress.notStarted,
      skipped: progress.skipped,
      stopped: progress.stopped,
    },
    {
      blocked: null,
      completed: 1,
      failed: 0,
      inProgress: 8,
      leads: 9,
      notStarted: 0,
      skipped: 0,
      stopped: 0,
    },
    "progressStats, with no count of blocked leads"
  );
  assert.equal(progress.campaignRef, `heyreach:client-a:${CAMPAIGN}`);
});

test("heyreach: placement tests are refused before any request, because LinkedIn has none", async () => {
  const { outbound, requests } = harness(suite);

  await assert.rejects(
    async () => await outbound.placementTests.list(),
    /placementTests\.list/u
  );
  assert.equal(requests.length, 0);
});
