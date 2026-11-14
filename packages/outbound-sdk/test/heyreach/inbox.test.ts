import assert from "node:assert/strict";
import { test } from "node:test";

import { harness } from "../helpers/adapter-suite.ts";
import { CAMPAIGN, suite } from "./suite.ts";

const LEAD = "https://www.linkedin.com/in/example-person-1";

test("heyreach: messages are read from conversations, with direction from the sender value", async () => {
  const { outbound, requests, settle } = harness(suite);

  const page = await settle(
    outbound.messages.list({ include: ["body"], limit: 500 })
  );

  assert.equal(
    new URL(requests[0]?.url ?? "").pathname,
    "/api/public/inbox/GetConversationsV2"
  );
  assert.equal(requests[0]?.method, "POST");
  assert.deepEqual(JSON.parse(requests[0]?.body ?? "{}"), {
    filters: {},
    limit: 100,
    offset: 0,
  });
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
  assert.equal(first?.threadId, "2-ExampleConversationId1==");
  assert.equal(first?.leadRef, `heyreach:client-a:${LEAD}`);
  assert.equal(first?.senderRef, "heyreach:client-a:4101");
  assert.equal(
    first?.campaignRef,
    null,
    "an unfiltered listing does not know the campaign"
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

test("heyreach: replies are the lead's messages only, with no category", async () => {
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
      ["in", "Happy to chat. Send me details.", "unknown", null, null],
      ["in", "Not interested right now.", "unknown", null, null],
    ]
  );
  await assert.rejects(
    async () => await outbound.replies.list({ category: "positive" }),
    /does not support it \(replies\.category\)/u
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

test("heyreach: a lead's timeline filters conversations by profile URL and walks every page", async () => {
  const { outbound, requests, settle } = harness(suite);
  const timeline = await settle(outbound.lead(LEAD).timeline());
  assert.equal(timeline.items.length, 6);
  assert.deepEqual(
    requests.map((request) => JSON.parse(request.body ?? "{}")),
    [
      { filters: { leadProfileUrl: LEAD }, limit: 100, offset: 0 },
      { filters: { leadProfileUrl: LEAD }, limit: 100, offset: 2 },
    ]
  );
  const times = timeline.items.map((message) => message.sentAt ?? "");
  assert.deepEqual(times, times.toSorted(), "oldest first");
});

test("heyreach: the inbox has no date filter, so the wrapper filters and says so", async () => {
  const { outbound, settle } = harness(suite);

  const page = await settle(
    outbound.messages.list({ since: "2026-10-07T11:00:00Z" })
  );

  assert.deepEqual(
    page.items.map((message) => message.sentAt),
    ["2026-10-07T12:00:00.000Z", "2026-10-07T12:05:00.000Z"]
  );
  assert.equal(page.meta.evidence, "derived");
});
