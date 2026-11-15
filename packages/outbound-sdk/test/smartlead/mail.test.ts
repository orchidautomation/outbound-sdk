import assert from "node:assert/strict";
import { test } from "node:test";

import { harness } from "../helpers/adapter-suite.ts";
import { fixture } from "../helpers/fixtures.ts";
import type { RecordedRequest } from "../helpers/http.ts";
import { API, CAMPAIGN, LEAD, suite, urlOf } from "./suite.ts";

const load = (name: string) => fixture("smartlead", name) as never;
const pathOf = (request: RecordedRequest): string => urlOf(request).pathname;

const bodyOf = (request: RecordedRequest | undefined) =>
  JSON.parse(request?.body ?? "{}") as Record<string, unknown>;

test("smartlead: messages come from the activity feed, in its own lane", async () => {
  const { outbound, requests, settle } = harness(suite);
  const page = await settle(outbound.messages.list({ limit: 5000 }));
  const url = urlOf(requests[0]);
  assert.equal(url.pathname, `${API}/campaigns/all-leads-activities`);
  assert.equal(url.searchParams.get("offset"), "0");
  assert.equal(url.searchParams.get("limit"), "1000", "the documented maximum");
  assert.equal(url.searchParams.get("event_time_from"), null);
  assert.equal(
    page.items.length,
    4,
    "two leads, each a sent email and a reply"
  );
  const [sent, reply] = page.items;
  assert.equal(sent?.sourceId, "12345", "stats_id");
  assert.equal(sent?.direction, "out");
  assert.equal(sent?.subject, "Quick question about your workflow");
  assert.equal(sent?.sentAt, "2025-11-26T10:00:00.000Z");
  assert.equal(sent?.stepIndex, 0, "email_seq_number 1");
  assert.equal(sent?.campaignRef, "smartlead:client-a:123");
  assert.equal(sent?.leadRef, "smartlead:client-a:2995276770");
  assert.equal(sent?.senderRef, null, "the feed names the mailbox by address");
  assert.equal(sent?.channel, "email");
  assert.equal(sent?.threadId, "2433664091", "email_lead_map_id");
  assert.equal(reply?.threadId, "2433664091");
  assert.equal(sent?.bodyText, null, "bodies are left out unless asked for");
  assert.equal(reply?.sourceId, "<reply123@example.com>");
  assert.equal(reply?.direction, "in");
  assert.equal(reply?.sentAt, "2025-11-26T14:30:00.000Z");
  assert.equal(reply?.subject, null);
  assert.equal(reply?.leadRef, "smartlead:client-a:2995276770");
  assert.equal(reply?.bodyText, null);

  const [snapshot] = await outbound.limits();
  assert.deepEqual(
    snapshot?.windows.flatMap((window) =>
      window.used > 0 ? [[window.lane, window.requests, window.used]] : []
    ),
    [
      ["default", 60, 1],
      ["all-leads-activities", 10, 1],
    ]
  );
});

test("smartlead: message bodies, the since filter and the next offset", async () => {
  const { outbound, requests, settle } = harness(suite);

  const messages = await settle(
    outbound.messages
      .listAll({
        include: ["body"],
        since: "2025-11-26T12:00:00Z",
        until: "2025-11-27T00:00:00Z",
      })
      .toArray()
  );

  assert.deepEqual(
    requests.map((request) => [
      urlOf(request).searchParams.get("offset"),
      urlOf(request).searchParams.get("event_time_from"),
      urlOf(request).searchParams.get("event_time_to"),
    ]),
    [
      ["0", "2025-11-26T12:00:00.000Z", null],
      ["2", "2025-11-26T12:00:00.000Z", null],
    ],
    "since narrows the feed; the end is never sent"
  );
  assert.deepEqual(
    messages.map((message) => [message.sourceId, message.bodyText]),
    [
      ["<reply123@example.com>", "Thanks for reaching out..."],
      ["<reply124@example.com>", "Thanks for reaching out..."],
      ["<reply125@example.com>", "Thanks for reaching out..."],
    ],
    "the wrapper keeps what was sent in the range: the replies, not the 10:00 emails"
  );

  const bodies = await settle(outbound.messages.list({ include: ["body"] }));
  assert.equal(bodies.items[0]?.bodyText, "Hi Alex, I wanted to reach out...");
  assert.equal(bodies.meta.evidence, "exact");
});

test("smartlead: a campaign's messages are picked from the feed, which has no campaign filter", async () => {
  const feed = load("listAllLeadsActivities.json") as {
    data: Record<string, unknown>[];
  };

  const { outbound, requests, settle } = harness(suite, () =>
    Response.json({
      data: [
        { ...feed.data[0], campaign_id: 372 },
        { ...feed.data[1], campaign_id: 999 },
        // No reply, an unknown step and a reply without a Message-ID.
        {
          activities: [
            {
              reply_details: null,
              sent_time: "2025-11-27T10:00:00Z",
              stats_id: 77,
            },
            {
              email_seq_number: 0,
              reply_details: { time: "2025-11-28T10:00:00Z" },
              stats_id: 78,
            },
          ],
          campaign_id: 372,
          lead_id: 5,
        },
      ],
      hasMore: false,
    })
  );

  const page = await settle(outbound.campaign(CAMPAIGN).messages.list());
  assert.equal(urlOf(requests[0]).searchParams.get("campaign_id"), null);
  assert.deepEqual(
    page.items.map((message) => [message.sourceId, message.direction]),
    [
      ["12345", "out"],
      ["<reply123@example.com>", "in"],
      ["77", "out"],
      ["78", "out"],
      [page.items[4]?.sourceId, "in"],
    ]
  );
  assert.match(page.items[4]?.sourceId ?? "", /^[\da-f]{32}$/u);
  assert.equal(page.items[3]?.stepIndex, null);
  assert.equal(page.complete, true);
});

test("smartlead: a lead's timeline reads its campaigns, then one history per campaign", async () => {
  const { outbound, requests, settle } = harness(suite);
  const timeline = await settle(outbound.lead(LEAD).timeline());

  assert.deepEqual(
    requests.map((request) => pathOf(request)),
    [
      `${API}/leads/789/campaigns`,
      `${API}/campaigns/2911/leads/789/message-history`,
      `${API}/campaigns/5055/leads/789/message-history`,
    ]
  );
  assert.deepEqual(
    timeline.items.map((message) => [
      message.sourceId,
      message.direction,
      message.sentAt,
      message.subject,
    ]),
    [
      [
        "00000000-0000-4000-8000-000000000001",
        "out",
        "2023-03-13T07:44:12.978Z",
        "Quick question for you, Alex",
      ],
      [
        "00000000-0000-4000-8000-000000000002",
        "out",
        "2023-03-15T07:50:56.673Z",
        "RE: Quick question for you, Alex",
      ],
      ["<reply-id-1@example.com>", "in", "2023-03-15T09:13:29.000Z", null],
    ],
    "a sent email is its stats_id, a reply its Message-ID"
  );
  assert.equal(timeline.items[0]?.leadRef, "smartlead:client-a:789");
  assert.equal(timeline.items[0]?.campaignRef, "smartlead:client-a:2911");
});

test("smartlead: a timeline inside one campaign is one request, with bodies on request", async () => {
  const { outbound, requests, settle } = harness(suite);

  const page = await settle(
    outbound
      .campaign(CAMPAIGN)
      .messages.list({ include: ["body"], leadId: LEAD })
  );

  assert.deepEqual(
    requests.map((request) => pathOf(request)),
    [`${API}/campaigns/372/leads/789/message-history`]
  );
  assert.equal(page.items[2]?.bodyText, "Yes, happy to chat");
  assert.equal(page.items[2]?.bodyHtml, "<p>Yes, happy to chat</p>");
  assert.equal(page.complete, true);

  const odd = harness(suite, () =>
    Response.json({
      history: [{ time: "2023-03-15T09:13:29.000Z", type: "REPLY" }],
    })
  );

  const [item] = (
    await odd.settle(
      odd.outbound.campaign(CAMPAIGN).messages.list({ leadId: LEAD })
    )
  ).items;

  assert.match(item?.sourceId ?? "", /^[\da-f]{32}$/u, "an item without ids");

  const nowhere = harness(suite, () => Response.json([]));
  const none = await nowhere.settle(nowhere.outbound.lead(LEAD).timeline());
  assert.deepEqual(none.items, [], "a lead in no campaign has no messages");
  assert.equal(nowhere.requests.length, 1);
});

test("smartlead: the other documented history shape fails instead of returning nothing", async () => {
  const { outbound, settle } = harness(suite, () =>
    Response.json(load("getLeadMessageHistory.newdocs.json"))
  );

  await assert.rejects(
    settle(
      outbound.campaign(CAMPAIGN).messages.list({ leadId: LEAD, retries: 0 })
    ),
    { code: "Provider" }
  );
});

test("smartlead: replies come from the master inbox with a fetched category", async () => {
  const { outbound, requests, settle } = harness(suite);
  const replies = await settle(outbound.replies.listAll().toArray());

  assert.deepEqual(
    requests.map((request) => [request.method, pathOf(request)]),
    [
      ["GET", `${API}/leads/fetch-categories`],
      ["POST", `${API}/master-inbox/inbox-replies`],
      ["POST", `${API}/master-inbox/inbox-replies`],
    ],
    "the categories are read once and then travel in the cursor"
  );
  assert.equal(
    urlOf(requests[1]).searchParams.get("fetch_message_history"),
    "true",
    "so a thread carries every reply when the API returns its history"
  );
  assert.deepEqual(bodyOf(requests[1]), { filters: {}, limit: 20, offset: 0 });
  assert.deepEqual(bodyOf(requests[2]), { filters: {}, limit: 20, offset: 2 });
  assert.equal(replies.length, 3);
  const [reply] = replies;
  assert.equal(reply?.sourceId, "email_abc123");
  assert.equal(reply?.direction, "in");
  assert.equal(reply?.subject, "Re: Partnership Opportunity");
  assert.equal(reply?.sentAt, "2025-01-20T14:30:00.000Z");
  assert.equal(reply?.campaignRef, "smartlead:client-a:12345");
  assert.equal(reply?.senderRef, "smartlead:client-a:789");
  assert.equal(reply?.threadId, "2433664091");
  assert.equal(reply?.leadRef, null, "the inbox names the lead by address");
  assert.equal(
    reply?.category,
    "positive",
    "category 1 has a positive sentiment"
  );
  assert.equal(
    reply?.categorySource,
    "lead",
    "the category is the lead's, not one message's"
  );
  assert.equal(reply?.unread, true, "is_read is false on the thread");
  assert.equal(reply?.isAuto, null);
  assert.equal(reply?.bodyText, null);
});

test("smartlead: reply filters are sent to the inbox as documented", async () => {
  const { outbound, requests, settle } = harness(suite);

  const page = await settle(
    outbound.campaign(CAMPAIGN).replies.list({
      category: "positive",
      include: ["body"],
      limit: 50,
      since: "2025-01-01T00:00:00Z",
      until: "2025-01-31T00:00:00Z",
    })
  );

  assert.deepEqual(bodyOf(requests[1]), {
    filters: {
      campaignId: 372,
      leadCategories: { categoryIdsIn: [1, 3] },
      replyTimeBetween: [
        "2025-01-01T00:00:00.000Z",
        "2025-01-31T00:00:00.000Z",
      ],
    },
    limit: 20,
    offset: 0,
  });
  assert.equal(page.items.length, 2);
  assert.equal(
    page.items[0]?.bodyText,
    "Thanks for reaching out! I'm interested in learning more about your solution..."
  );
  assert.equal(page.meta.evidence, "derived", "the wrapper checks the dates");

  const open = harness(suite);
  await open.settle(open.outbound.replies.list({ since: "2025-01-01" }));

  const [from, to] = (
    bodyOf(open.requests[1]).filters as { replyTimeBetween: string[] }
  ).replyTimeBetween;

  assert.equal(from, "2025-01-01T00:00:00.000Z");
  assert.ok(Date.parse(to ?? "") > Date.now(), "an open end is after now");

  const until = harness(suite);
  await until.settle(until.outbound.replies.list({ until: "2025-01-31" }));
  assert.deepEqual(
    (bodyOf(until.requests[1]).filters as { replyTimeBetween: string[] })
      .replyTimeBetween,
    ["1970-01-01T00:00:00.000Z", "2025-01-31T23:59:59.999Z"]
  );
});

const inbox = (categories: (number | null)[], start = 0) => ({
  messages: categories.map((id, index) => ({
    category: id === null ? null : { id },
    id: `thread_${start + index}`,
    last_message: { received_at: "2025-01-20T14:30:00Z" },
  })),
});

const categoryHarness = (list: unknown, categories: (number | null)[]) =>
  harness(suite, (request) =>
    request.method === "GET"
      ? Response.json(list)
      : Response.json(inbox(categories))
  );

test("smartlead: a category follows sentiment_type, and Out Of Office by name", async () => {
  const list = [
    { id: 11, name: "Hot", sentiment_type: "positive" },
    { id: 12, name: "Cold", sentiment_type: "negative" },
    { id: 13, name: "Later", sentiment_type: null },
    { id: 14, name: "Out Of Office", sentiment_type: null },
    { id: 15, name: "Odd", sentiment_type: "mixed" },
  ];

  const { outbound, settle } = categoryHarness(list, [
    11,
    12,
    13,
    14,
    15,
    99,
    null,
  ]);

  const page = await settle(outbound.replies.list());
  assert.deepEqual(
    page.items.map((reply) => [
      reply.category,
      reply.categorySource,
      reply.isAuto,
    ]),
    [
      ["positive", "lead", null],
      ["negative", "lead", null],
      ["neutral", "lead", null],
      ["ooo", "lead", true],
      ["unknown", null, null],
      ["unknown", null, null],
      ["unknown", null, null],
    ]
  );
  assert.equal(page.items[0]?.sourceId, "thread_0", "no last_message id");
});

test("smartlead: the older category list has no sentiment, so only Out Of Office is known", async () => {
  const { outbound, settle } = categoryHarness(
    load("listLeadCategories.legacy.json"),
    [1, 2, 3, 4, 5, 6, 7]
  );

  const page = await settle(outbound.replies.list());
  assert.deepEqual(
    page.items.map((reply) => reply.category),
    ["unknown", "unknown", "unknown", "unknown", "unknown", "ooo", "unknown"]
  );
});

test("smartlead: a category filter narrows by id when it can, and always matches the mapped value", async () => {
  const none = harness(suite);

  const bounced = await none.settle(
    none.outbound.replies.list({ category: "bounce" })
  );

  assert.deepEqual(bounced.items, []);
  assert.equal(
    none.requests.length,
    1,
    "no category means bounce: no inbox call"
  );

  const unknown = categoryHarness(load("listLeadCategories.json"), [
    1,
    null,
    2,
  ]);

  const uncategorized = await unknown.settle(
    unknown.outbound.replies.list({ category: "unknown" })
  );

  assert.deepEqual(
    uncategorized.items.map((reply) => reply.sourceId),
    ["thread_1"]
  );
  assert.deepEqual(bodyOf(unknown.requests[1]).filters, {});

  const many = categoryHarness(
    Array.from({ length: 11 }, (_unused, index) => ({
      id: index + 1,
      name: `Good ${index}`,
      sentiment_type: "positive",
    })),
    [1, null]
  );

  const positive = await many.settle(
    many.outbound.replies.list({ category: "positive" })
  );

  assert.deepEqual(
    bodyOf(many.requests[1]).filters,
    {},
    "more than ten ids do not fit the filter"
  );
  assert.equal(positive.items.length, 1);
});

test("smartlead: without a total, a full inbox page means there may be more", async () => {
  const { outbound, requests, settle } = harness(suite, (request) => {
    if (request.method === "GET") {
      return Response.json(load("listLeadCategories.json"));
    }

    return Response.json(
      bodyOf(request).offset === 0 ? inbox([1, 2]) : inbox([3], 2)
    );
  });

  const replies = await settle(
    outbound.replies.listAll({ limit: 2 }).toArray()
  );

  assert.deepEqual(
    replies.map((reply) => reply.category),
    ["positive", "negative", "positive"]
  );
  assert.deepEqual(
    requests.slice(1).map((request) => bodyOf(request).offset),
    [0, 2]
  );
});
