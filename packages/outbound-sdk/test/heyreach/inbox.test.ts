import assert from "node:assert/strict";
import { test } from "node:test";

import { harness } from "../helpers/adapter-suite.ts";
import type { RecordedRequest } from "../helpers/http.ts";
import { CAMPAIGN, suite, THREAD } from "./suite.ts";

const LEAD = "https://www.linkedin.com/in/example-person-1";

const CONVERSATIONS = "/api/public/inbox/GetConversationsV3";

/** The bodies of the conversation listings, in the order they were sent. */
const listings = (requests: readonly RecordedRequest[]) =>
  requests.flatMap((request) =>
    new URL(request.url).pathname === CONVERSATIONS
      ? [JSON.parse(request.body ?? "{}")]
      : []
  );

test("heyreach: messages are read from conversations, with direction from the sender value", async () => {
  const { outbound, requests, settle } = harness(suite);

  const page = await settle(
    outbound.messages.list({ include: ["body"], limit: 500 })
  );

  assert.equal(
    new URL(requests[0]?.url ?? "").pathname,
    "/api/public/campaign/GetAll",
    "the campaigns come first: a conversation names none of its own"
  );
  assert.equal(new URL(requests.at(-1)?.url ?? "").pathname, CONVERSATIONS);
  assert.equal(requests.at(-1)?.method, "POST");
  assert.deepEqual(listings(requests), [
    { filters: { campaignIds: [Number(CAMPAIGN)] }, limit: 100 },
  ]);
  assert.deepEqual(
    page.items.map((message) => [
      message.direction,
      message.sentAt,
      message.bodyText,
    ]),
    [
      ["out", "2026-10-05T14:00:00.000Z", "Hi Alex, thanks for connecting."],
      ["in", "2026-10-06T09:30:00.000Z", "Happy to chat. Send me details."],
      [
        "out",
        "2026-10-07T10:00:00.000Z",
        "Hello, a quick question about Example Co.",
      ],
      ["in", "2026-10-07T12:00:00.000Z", "Not interested right now."],
      ["out", "2026-10-07T12:05:00.000Z", "Understood, thanks."],
    ],
    "ME is out, CORRESPONDENT is in"
  );
  const [first, , inmail] = page.items;
  assert.equal(first?.channel, "linkedin");
  assert.equal(
    first?.threadId,
    "4101:2-ExampleConversationId1==",
    "the account id and the conversation id, which a thread read needs"
  );
  assert.equal(first?.leadRef, `heyreach:client-a:${LEAD}`);
  assert.equal(first?.senderRef, "heyreach:client-a:4101");
  assert.equal(
    first?.campaignRef,
    `heyreach:client-a:${CAMPAIGN}`,
    "an unfiltered listing names each conversation's campaign"
  );
  assert.equal(first?.subject, null);
  assert.equal(
    inmail?.subject,
    "A quick question",
    "only an InMail has a subject"
  );
  assert.ok(page.cursor, "more conversations remain");
});

test("heyreach: a message id is stable across reads and unique within a thread", async () => {
  const first = harness(suite);
  const again = harness(suite);
  const one = await first.settle(first.outbound.messages.listAll().toArray());
  const two = await again.settle(again.outbound.messages.listAll().toArray());
  assert.deepEqual(
    one.map((message) => message.ref),
    two.map((message) => message.ref)
  );
  assert.equal(new Set(one.map((message) => message.ref)).size, 6);
  assert.match(one[0]?.sourceId ?? "", /^[0-9a-f]{32}$/u);
  assert.equal(one[0]?.bodyText, null, "bodies are left out unless asked for");
});

test("heyreach: replies are the lead's messages only, and an untagged lead's have no category", async () => {
  const { outbound, settle } = harness(suite);

  const replies = await settle(
    outbound.replies.listAll({ include: ["body"] }).toArray()
  );

  assert.deepEqual(
    replies.map((reply) => [
      reply.direction,
      reply.bodyText,
      reply.category,
      reply.categorySource,
      reply.isAuto,
    ]),
    [
      ["in", "Happy to chat. Send me details.", "unknown", null, false],
      ["in", "Not interested right now.", "unknown", null, false],
    ]
  );

  const positive = await settle(
    outbound.replies.list({ category: "positive" })
  );

  assert.deepEqual(
    positive.items,
    [],
    "no documented conversation carries an auto-tag, so none is positive"
  );
});

test("heyreach: a campaign's messages send the campaign filter and carry its ref", async () => {
  const { outbound, requests, settle } = harness(suite);
  const page = await settle(outbound.campaign(CAMPAIGN).messages.list());
  assert.deepEqual(JSON.parse(requests[0]?.body ?? "{}").filters, {
    campaignIds: [Number(CAMPAIGN)],
  });
  assert.equal(page.items[0]?.campaignRef, `heyreach:client-a:${CAMPAIGN}`);
});

test("heyreach: a lead's timeline walks only that lead's campaigns, filtered by profile URL, and every page", async () => {
  const { outbound, requests, settle } = harness(suite);
  const timeline = await settle(outbound.lead(LEAD).timeline());
  assert.equal(timeline.items.length, 6, "no conversation comes twice");
  assert.deepEqual(
    requests
      .filter((request) => request.url.endsWith("/GetCampaignsForLead"))
      .map((request) => JSON.parse(request.body ?? "{}").profileUrl),
    [LEAD, LEAD],
    "the lead's campaigns, two pages of them, not the workspace's"
  );
  assert.equal(
    requests.some((request) => request.url.endsWith("/campaign/GetAll")),
    false
  );

  const sent = listings(requests);
  assert.ok(sent.every((body) => body.filters.leadProfileUrl === LEAD));
  assert.deepEqual(
    sent.slice(0, 4).map((body) => [body.filters.campaignIds, body.cursor]),
    [
      [[274_079], undefined],
      [[274_079], "ExampleCursorPage2"],
      [[274_080], undefined],
      [[274_081], undefined],
    ],
    "one campaign after the other, each page by page"
  );
  assert.deepEqual(
    sent[4],
    { filters: { leadProfileUrl: LEAD }, limit: 100 },
    "then the lead's conversations in no campaign"
  );
  const times = timeline.items.map((message) => message.sentAt ?? "");
  assert.deepEqual(times, times.toSorted(), "oldest first");
});

test("heyreach: a since filter bounds the conversations at HeyReach and drops the older messages inside them", async () => {
  const { outbound, requests, settle } = harness(suite);

  const page = await settle(
    outbound.messages.list({ since: "2026-10-07T11:00:00Z" })
  );

  assert.equal(
    listings(requests)[0]?.from,
    "2026-10-07T11:00:00.000Z",
    "the lower bound on a conversation's newest message"
  );
  assert.deepEqual(
    page.items.map((message) => message.sentAt),
    ["2026-10-07T12:00:00.000Z", "2026-10-07T12:05:00.000Z"]
  );
  assert.equal(page.meta.evidence, "exact");

  const replies = await settle(
    outbound.replies.list({ since: "2026-10-07T11:00:00Z" })
  );

  assert.deepEqual(
    replies.items.map((reply) => reply.sentAt),
    ["2026-10-07T12:00:00.000Z"]
  );
});

test("heyreach: an until filter is not sent, because a later conversation still holds earlier messages", async () => {
  const { outbound, requests, settle } = harness(suite);

  const page = await settle(
    outbound.messages.list({ until: "2026-10-06T00:00:00Z" })
  );

  for (const body of listings(requests)) {
    assert.equal(body.from, undefined);
    assert.equal(body.to, undefined);
  }

  assert.deepEqual(
    page.items.map((message) => message.sentAt),
    ["2026-10-05T14:00:00.000Z"]
  );
});

test("heyreach: the listing stops when HeyReach says there is no next page, and a marker from the old offset paging starts over", async () => {
  const { outbound, requests, settle } = harness(suite, () =>
    Response.json({
      hasNextPage: false,
      items: [],
      nextCursor: "ExampleCursorIgnored",
      totalCount: 0,
    })
  );

  const page = await settle(outbound.messages.list());
  assert.equal(page.cursor, undefined);
  assert.equal(JSON.parse(requests[0]?.body ?? "{}").cursor, undefined);
});

test("heyreach: one conversation is read whole by its thread id, account first", async () => {
  const { outbound, requests, settle } = harness(suite);
  const thread = await settle(outbound.thread(THREAD).messages());
  assert.equal(requests.length, 1);
  assert.equal(requests[0]?.method, "GET");
  assert.equal(
    new URL(requests[0]?.url ?? "").pathname,
    "/api/public/inbox/GetChatroom/4101/2-ExampleConversationId1%3D%3D"
  );
  assert.deepEqual(
    thread.items.map((message) => [
      message.direction,
      message.sentAt,
      message.bodyText,
    ]),
    [
      ["out", "2026-10-05T14:00:00.000Z", null],
      ["in", "2026-10-06T09:30:00.000Z", null],
      ["out", "2026-10-06T11:00:00.000Z", null],
    ],
    "bodies are returned only when asked for"
  );

  for (const message of thread.items) {
    assert.equal(message.threadId, THREAD);
    assert.equal(message.senderRef, "heyreach:client-a:4101");
    assert.equal(message.leadRef, `heyreach:client-a:${LEAD}`);
    assert.equal(message.campaignRef, null, "a chatroom names no campaign");
  }

  const withBodies = await settle(
    outbound.thread(THREAD).messages({ include: ["body"] })
  );

  assert.equal(withBodies.items[2]?.bodyText, "Here are the details.");
});

test("heyreach: a thread read gives a message the same id as the inbox listing", async () => {
  const { outbound, settle } = harness(suite);
  const listed = await settle(outbound.messages.list());
  const thread = await settle(outbound.thread(THREAD).messages());
  assert.equal(thread.items[0]?.ref, listed.items[0]?.ref);
  assert.equal(thread.items[0]?.threadId, listed.items[0]?.threadId);
});

test("heyreach: a thread id without an account id is refused before any request", async () => {
  for (const id of ["2-ExampleConversationId1==", "sam:2-Example", "4101:"]) {
    const { outbound, requests } = harness(suite);
    await assert.rejects(
      async () => await outbound.thread(id).messages({ retries: 0 }),
      (error) =>
        error instanceof Error &&
        "code" in error &&
        error.code === "Invalid" &&
        error.message.includes("<accountId>:<conversationId>")
    );
    assert.equal(requests.length, 0);
  }
});

test("heyreach: a conversation without an account id has no thread to read back", async () => {
  const { outbound, settle } = harness(suite, () =>
    Response.json({
      items: [
        {
          id: "2-ExampleConversationId9==",
          messages: [{ body: "Hello", createdAt: "2026-10-05T14:00:00Z" }],
        },
      ],
      totalCount: 1,
    })
  );

  const [message] = (await settle(outbound.messages.list())).items;
  assert.equal(message?.threadId, null);
  assert.equal(message?.senderRef, null);
});
