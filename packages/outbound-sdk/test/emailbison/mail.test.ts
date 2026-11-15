import assert from "node:assert/strict";
import { test } from "node:test";

import { harness } from "../helpers/adapter-suite.ts";
import { CAMPAIGN, LEAD, suite, THREAD } from "./suite.ts";

const urlOf = (request: { url: string } | undefined): URL =>
  new URL(request?.url ?? "");

test("emailbison: messages are sent campaign emails, asked for by status and cursor", async () => {
  const { outbound, requests, settle } = harness(suite);

  const messages = await settle(
    outbound.messages.listAll({ include: ["body"] }).toArray()
  );

  assert.deepEqual(
    messages.map((message) => [
      message.sourceId,
      message.direction,
      message.sentAt,
      message.leadRef,
      message.senderRef,
      message.campaignRef,
      message.threadId,
    ]),
    [
      [
        "scheduled-5001",
        "out",
        "2025-11-25T19:12:26.000Z",
        "emailbison:client-a:101",
        "emailbison:client-a:1",
        "emailbison:client-a:1",
        null,
      ],
      [
        "scheduled-5002",
        "out",
        "2025-11-25T19:20:00.000Z",
        "emailbison:client-a:102",
        "emailbison:client-a:1",
        "emailbison:client-a:1",
        null,
      ],
      [
        "scheduled-5003",
        "out",
        "2025-11-28T15:00:00.000Z",
        "emailbison:client-a:101",
        "emailbison:client-a:1",
        "emailbison:client-a:1",
        null,
      ],
    ]
  );
  assert.equal(messages[0]?.subject, "Quick question");
  assert.equal(messages[0]?.bodyText, "Hi Alex,\nWorth a quick chat?");

  const first = urlOf(requests[0]);
  assert.equal(first.pathname, "/api/scheduled-emails");
  assert.equal(first.searchParams.get("status"), "sent");
  assert.equal(first.searchParams.get("pagination_type"), "cursor");
  assert.equal(
    urlOf(requests[1]).searchParams.get("cursor"),
    "eyJpZCI6NTAwMn0"
  );
});

test("emailbison: a campaign's messages filter the same read by campaign", async () => {
  const { outbound, requests, settle } = harness(suite);
  await settle(outbound.messages.list({ campaignId: CAMPAIGN }));
  assert.equal(urlOf(requests[0]).searchParams.get("campaign_ids[]"), "1");
});

test("emailbison: bodies are left out unless asked for", async () => {
  const { outbound, settle } = harness(suite);
  const page = await settle(outbound.messages.list());
  assert.equal(page.items[0]?.bodyHtml, null);
  assert.equal(page.items[0]?.bodyText, null);
});

test("emailbison: a lead's timeline is its sent emails, then its inbox messages, in time order", async () => {
  const { outbound, requests, settle } = harness(suite);
  const timeline = await settle(outbound.lead(LEAD).timeline());

  assert.deepEqual(
    timeline.items.map((message) => [
      message.sourceId,
      message.direction,
      message.sentAt,
    ]),
    [
      ["scheduled-5001", "out", "2025-11-25T19:12:26.000Z"],
      ["44", "out", "2025-11-26T08:00:00.000Z"],
      ["45", "in", "2025-11-26T09:10:42.000Z"],
    ],
    "the scheduled, unsent email 5004 is not a message"
  );

  assert.deepEqual(
    requests.map((request) => urlOf(request).pathname),
    ["/api/leads/101/sent-emails", "/api/leads/101/replies"]
  );
  assert.equal(urlOf(requests[1]).searchParams.get("folder"), "all");
});

test("emailbison: a thread is the messages before and after one reply", async () => {
  const { outbound, requests, settle } = harness(suite);
  const thread = await settle(outbound.thread(THREAD).messages());

  assert.deepEqual(
    thread.items.map((message) => [message.sourceId, message.direction]),
    [
      ["44", "out"],
      ["45", "in"],
      ["48", "out"],
    ]
  );
  assert.equal(requests.length, 1);
  assert.equal(
    urlOf(requests[0]).pathname,
    "/api/replies/45/conversation-thread"
  );
});

test("emailbison: replies are the inbox folder, with the vendor's category and read state", async () => {
  const { outbound, requests, settle } = harness(suite);

  const replies = await settle(
    outbound.replies.listAll({ include: ["body"] }).toArray()
  );

  assert.deepEqual(
    replies.map((reply) => [
      reply.sourceId,
      reply.category,
      reply.categorySource,
      reply.isAuto,
      reply.unread,
      reply.leadRef,
      reply.campaignRef,
    ]),
    [
      [
        "45",
        "positive",
        "vendor",
        false,
        true,
        "emailbison:client-a:101",
        "emailbison:client-a:1",
      ],
      [
        "46",
        "ooo",
        "vendor",
        true,
        false,
        "emailbison:client-a:102",
        "emailbison:client-a:1",
      ],
      ["47", "unknown", null, false, false, "emailbison:client-a:101", null],
    ]
  );
  assert.equal(replies[0]?.threadId, "45");
  assert.equal(
    replies[0]?.bodyText,
    "Yes, let's talk on Tuesday.",
    "quoted history is cut"
  );
  assert.equal(replies[0]?.senderRef, "emailbison:client-a:1");
  assert.equal(urlOf(requests[0]).searchParams.get("folder"), "inbox");
});

test("emailbison: positive and ooo are filtered by EmailBison, and unread by read", async () => {
  const positive = harness(suite);

  const interested = await positive.settle(
    positive.outbound.replies.list({ category: "positive", unread: true })
  );

  const url = urlOf(positive.requests[0]);
  assert.equal(url.searchParams.get("status"), "interested");
  assert.equal(url.searchParams.get("read"), "0", "1 or 0, never the word");
  assert.deepEqual(
    interested.items.map((reply) => reply.sourceId),
    ["45"]
  );

  const ooo = harness(suite);
  await ooo.settle(ooo.outbound.replies.list({ category: "ooo" }));
  assert.equal(
    urlOf(ooo.requests[0]).searchParams.get("status"),
    "automated_reply"
  );
});

test("emailbison: a category EmailBison cannot filter is matched after mapping", async () => {
  const { outbound, requests, settle } = harness(suite);
  const page = await settle(outbound.replies.list({ category: "unknown" }));
  assert.equal(urlOf(requests[0]).searchParams.get("status"), null);
  assert.deepEqual(
    page.items.map((reply) => reply.sourceId),
    []
  );

  const second = await settle(
    outbound.replies.listAll({ category: "unknown" }).toArray()
  );

  assert.deepEqual(
    second.map((reply) => reply.sourceId),
    ["47"]
  );
});
