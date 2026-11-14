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
