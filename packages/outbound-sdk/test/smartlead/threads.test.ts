import assert from "node:assert/strict";
import { test } from "node:test";

import { harness } from "../helpers/adapter-suite.ts";
import { fixture } from "../helpers/fixtures.ts";
import type { RecordedRequest } from "../helpers/http.ts";
import { API, suite, THREAD, urlOf } from "./suite.ts";

const load = (name: string) => fixture("smartlead", name) as never;
const pathOf = (request: RecordedRequest): string => urlOf(request).pathname;

test("smartlead: a thread is one master inbox item, read by its mapping id", async () => {
  const { outbound, requests, settle } = harness(suite);
  const thread = await settle(outbound.thread(THREAD).messages());

  assert.deepEqual(
    requests.map((request) => [request.method, pathOf(request)]),
    [["GET", `${API}/master-inbox/2433664091`]]
  );
  assert.equal(thread.complete, true, "one request holds the whole thread");
  assert.deepEqual(
    thread.items.map((message) => [
      message.direction,
      message.subject,
      message.sentAt,
    ]),
    [
      ["out", "Partnership Opportunity", "2025-01-15T10:00:00.000Z"],
      ["in", "Re: Partnership Opportunity", "2025-01-20T14:00:00.000Z"],
    ]
  );
  const [sent, reply] = thread.items;
  assert.equal(sent?.threadId, "2433664091");
  assert.equal(sent?.campaignRef, "smartlead:client-a:12345");
  assert.equal(sent?.leadRef, null, "the example names the lead by address");
  assert.equal(sent?.senderRef, null, "the example names no mailbox");
  assert.equal(sent?.channel, "email");
  assert.equal(sent?.bodyText, null);
  assert.notEqual(
    sent?.sourceId,
    "",
    "an item without an id gets a stable one"
  );
  assert.notEqual(sent?.sourceId, reply?.sourceId);

  const again = harness(suite);
  const second = await again.settle(again.outbound.thread(THREAD).messages());
  assert.equal(second.items[0]?.sourceId, sent?.sourceId, "stable ids");
});

test("smartlead: a thread with ids, bodies, a lead id and a mailbox maps them all", async () => {
  const [item] = (
    load("listInboxReplies.history.json") as { messages: object[] }
  ).messages;

  const { outbound, settle } = harness(suite, () =>
    Response.json({ data: item, ok: true })
  );

  const thread = await settle(
    outbound.thread("77").messages({ include: ["body"] })
  );

  assert.deepEqual(
    thread.items.map((message) => [
      message.sourceId,
      message.direction,
      message.sentAt,
    ]),
    [
      ["msg_1", "out", "2025-01-15T10:00:00.000Z"],
      ["msg_2", "in", "2025-01-20T14:30:00.000Z"],
      ["msg_3", "in", "2025-01-21T09:15:00.000Z"],
    ]
  );
  const [sent] = thread.items;
  assert.equal(sent?.bodyText, "Hi Alex, I noticed your company...");
  assert.equal(sent?.leadRef, "smartlead:client-a:2995276770", "lead.id");
  assert.equal(sent?.senderRef, "smartlead:client-a:789");
  assert.equal(sent?.threadId, "77", "the id that was asked, not the body's");
});

test("smartlead: a thread in the older history shape maps type, time and email_body", async () => {
  const { outbound, settle } = harness(suite, () =>
    Response.json({
      campaign: { id: 5 },
      lead_id: 31,
      message_history: [
        {
          email_body: "<p>First touch</p>",
          message_id: "<sent-1@example.com>",
          stats_id: "stats-1",
          subject: "Hello",
          time: "2025-02-01T08:00:00.000Z",
          type: "SENT",
        },
        {
          email_body: "<p>Sounds good</p>",
          message_id: "<reply-1@example.com>",
          stats_id: "stats-1",
          time: "2025-02-02T09:30:00.000Z",
          type: "REPLY",
        },
      ],
    })
  );

  const thread = await settle(
    outbound.thread(THREAD).messages({ include: ["body"] })
  );

  assert.deepEqual(
    thread.items.map((message) => [
      message.sourceId,
      message.direction,
      message.sentAt,
      message.bodyText,
    ]),
    [
      ["stats-1", "out", "2025-02-01T08:00:00.000Z", "First touch"],
      [
        "<reply-1@example.com>",
        "in",
        "2025-02-02T09:30:00.000Z",
        "Sounds good",
      ],
    ]
  );
  assert.equal(thread.items[0]?.leadRef, "smartlead:client-a:31", "lead_id");
});

test("smartlead: a thread answer that is not an object fails instead of returning nothing", async () => {
  const { outbound, settle } = harness(suite, () => Response.json([]));

  await assert.rejects(
    settle(outbound.thread(THREAD).messages({ retries: 0 })),
    { code: "Provider" }
  );
});

test("smartlead: every inbound message of a thread's history is a reply", async () => {
  const { outbound, settle } = harness(suite, (request) =>
    pathOf(request) === `${API}/master-inbox/inbox-replies`
      ? Response.json(load("listInboxReplies.history.json"))
      : undefined
  );

  const page = await settle(outbound.replies.list({ include: ["body"] }));

  assert.deepEqual(
    page.items.map((reply) => [reply.sourceId, reply.sentAt, reply.bodyText]),
    [
      [
        "msg_2",
        "2025-01-20T14:30:00.000Z",
        "Thanks for reaching out! I'm interested...",
      ],
      [
        "msg_3",
        "2025-01-21T09:15:00.000Z",
        "One more thing: could you send pricing?",
      ],
    ],
    "the outbound message is left out and the latest reply is not repeated"
  );

  for (const reply of page.items) {
    assert.equal(reply.direction, "in");
    assert.equal(reply.threadId, "2433664091");
    assert.equal(reply.leadRef, "smartlead:client-a:2995276770");
    assert.equal(reply.senderRef, "smartlead:client-a:789");
    assert.equal(reply.campaignRef, "smartlead:client-a:12345");
    assert.equal(reply.category, "positive", "the thread's category");
    assert.equal(reply.categorySource, "vendor");
  }

  assert.equal(page.complete, true);
});
