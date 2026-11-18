import assert from "node:assert/strict";
import { test } from "node:test";

import {
  createOutbound,
  MemoryRateLimitStore,
  OutboundError,
} from "../../src/index.ts";
import { insights } from "../../src/insights/index.ts";
import type { MemoryData, MemoryMessage } from "../../src/memory/index.ts";
import { fixtureHandler } from "../helpers/adapter-suite.ts";
import { createClock } from "../helpers/clock.ts";
import { fixture } from "../helpers/fixtures.ts";
import { createFetch, json } from "../helpers/http.ts";
import { suite as instantly } from "../instantly/suite.ts";
import { agency, NOW, single } from "./helpers.ts";

const REPLIERS = (
  fixture("instantly", "listLeadsByEmail.repliers.json") as {
    items: { id: string }[];
  }
).items;

// NOW is 2026-11-14T12:00:00Z.
const DATA: MemoryData = {
  campaigns: [
    { id: "c1", name: "Agency owners" },
    { channel: "linkedin", id: "c2", name: "LinkedIn founders" },
  ],
  leads: [
    {
      campaignId: "c1",
      email: "person1@example.com",
      firstName: "Jon",
      id: "l1",
      lastName: "Example",
    },
    { campaignId: "c1", email: "person2@example.com", id: "l2" },
    { campaignId: "c1", email: "person3@example.com", id: "l3" },
    {
      campaignId: "c2",
      id: "l4",
      linkedinUrl: "https://www.linkedin.com/in/example-person",
    },
  ],
  messages: [
    // Thread t1: two replies after the last send, the first 100 hours ago.
    {
      campaignId: "c1",
      direction: "out",
      id: "m1",
      leadId: "l1",
      sentAt: "2026-11-09T08:00:00.000Z",
      threadId: "t1",
    },
    {
      campaignId: "c1",
      category: "positive",
      direction: "in",
      id: "m2",
      leadId: "l1",
      sentAt: "2026-11-10T08:00:00.000Z",
      subject: "Re: hello",
      threadId: "t1",
    },
    {
      campaignId: "c1",
      direction: "in",
      id: "m3",
      leadId: "l1",
      sentAt: "2026-11-12T08:00:00.000Z",
      threadId: "t1",
    },
    // Thread t2: answered an hour after the reply.
    {
      campaignId: "c1",
      category: "neutral",
      direction: "in",
      id: "m4",
      leadId: "l2",
      sentAt: "2026-11-11T08:00:00.000Z",
      threadId: "t2",
    },
    {
      campaignId: "c1",
      direction: "out",
      id: "m5",
      leadId: "l2",
      sentAt: "2026-11-11T09:00:00.000Z",
      threadId: "t2",
    },
    // No thread: checked on the lead's timeline. 30.5 hours ago, nothing after.
    {
      campaignId: "c2",
      category: "positive",
      direction: "in",
      id: "m6",
      leadId: "l4",
      sentAt: "2026-11-13T05:30:00.000Z",
    },
    // Unanswered but only 6 hours old.
    {
      campaignId: "c1",
      category: "neutral",
      direction: "in",
      id: "m7",
      leadId: "l3",
      sentAt: "2026-11-14T06:00:00.000Z",
      threadId: "t3",
    },
    // Needs no answer.
    {
      campaignId: "c1",
      category: "ooo",
      direction: "in",
      id: "m8",
      leadId: "l3",
      sentAt: "2026-11-10T06:00:00.000Z",
      threadId: "t4",
    },
    {
      campaignId: "c1",
      category: "negative",
      direction: "in",
      id: "m9",
      leadId: "l3",
      sentAt: "2026-11-10T07:00:00.000Z",
      threadId: "t5",
    },
    // An automatic reply the vendor filed as neutral.
    {
      campaignId: "c1",
      category: "neutral",
      direction: "in",
      id: "m10",
      isAuto: true,
      leadId: "l3",
      sentAt: "2026-11-10T09:00:00.000Z",
      threadId: "t6",
    },
    // Neither a thread nor a lead to read.
    {
      campaignId: "c1",
      category: "positive",
      direction: "in",
      id: "m11",
      sentAt: "2026-11-10T10:00:00.000Z",
    },
    // Before the default 14 days.
    {
      campaignId: "c1",
      category: "positive",
      direction: "in",
      id: "m12",
      leadId: "l2",
      sentAt: "2026-10-20T10:00:00.000Z",
      threadId: "t7",
    },
  ],
};

test("dropped_replies reports unanswered replies longest waiting first, and counts the rest", async () => {
  const result = await single(DATA).insights.droppedReplies({}, { now: NOW });
  const { data } = result;

  assert.equal(result.insight, "dropped_replies");
  assert.deepEqual(
    data.dropped.map(
      ({ activity, followUp, meeting, vendorSentiment, ...each }) => each
    ),
    [
      {
        campaign: "memory:agency:c1",
        campaignName: "Agency owners",
        category: "positive",
        channel: "email",
        checkedBy: "thread",
        // The thread's latest message is m3, a later reply with no label.
        finding:
          "A positive reply has waited 4 days with nothing sent after it. The latest message is inbound and unanswered for 2 days (received 2026-11-12 08:00 UTC). Read it before following up.",
        // 2026-11-10T08:00 to 2026-11-14T12:00 is 4 days and 4 hours.
        email: "person1@example.com",
        hoursWaiting: 100,
        lead: "memory:agency:l1",
        linkedinUrl: null,
        name: "Jon Example",
        provider: "memory",
        receivedAt: "2026-11-10T08:00:00.000Z",
        reply: "memory:agency:m2",
        subject: "Re: hello",
        unansweredReplies: 2,
      },
      {
        campaign: "memory:agency:c2",
        campaignName: "LinkedIn founders",
        category: "positive",
        channel: "linkedin",
        checkedBy: "timeline",
        finding:
          "A positive reply has waited 30 hours with nothing sent after it.",
        email: null,
        hoursWaiting: 30.5,
        lead: "memory:agency:l4",
        linkedinUrl: "https://www.linkedin.com/in/example-person",
        name: null,
        provider: "memory",
        receivedAt: "2026-11-13T05:30:00.000Z",
        reply: "memory:agency:m6",
        subject: null,
        unansweredReplies: 1,
      },
    ]
  );
  const [first, second] = data.dropped;

  assert.equal(first?.activity?.latest?.ref, "memory:agency:m3");
  assert.equal(first?.activity?.lastOutboundAt, "2026-11-09T08:00:00.000Z");
  assert.deepEqual(first?.vendorSentiment, {
    leadCategory: null,
    leadLabel: null,
    replyCategory: "positive",
  });
  assert.deepEqual(first?.followUp, {
    basis: "inbound_unanswered",
    evidence: [
      "The latest message is inbound and unanswered for 2 days (received 2026-11-12 08:00 UTC).",
      "The vendor's positive label is on an earlier reply (2026-11-10 08:00 UTC), 2 days before the latest message, so it may not describe the conversation now.",
      "memory records no meeting for the lead.",
    ],
    needed: true,
    unchecked: [
      "What the messages say: the rules read who wrote last and when, never the words, so read the latest message before acting.",
    ],
  });
  // The labelled reply is the latest message, so no label sentence.
  assert.equal(second?.activity?.latest?.ref, "memory:agency:m6");
  assert.equal(second?.followUp?.evidence.length, 2);
  assert.deepEqual(data.totals, {
    answered: 1,
    // t1, t2, the timeline of l4, t3 and the reply with nothing to read.
    conversations: 5,
    dropped: 2,
    moreRepliesExist: false,
    notInCampaign: null,
    // The ten inbound messages but the one from October.
    repliesRead: 9,
    skippedAuto: 1,
    skippedByCategory: 2,
    tooRecent: 1,
    unchecked: 1,
  });
  assert.equal(data.since, "2026-10-31T12:00:00.000Z");
  assert.equal(data.olderThanHours, 24);
  // The reply with nothing to read is unchecked, so the answer is partial, not a clean 2.
  assert.equal(result.meta.complete, false);
  assert.deepEqual(result.meta.notes, [
    "1 conversation of 5 could not be checked, so dropped counts only the 4 that were. totals.unchecked counts the rest, as neither dropped nor answered.",
  ]);
});

test("dropped_replies on Instantly reads each waiting person's lead and campaign, and counts every request", async () => {
  const clock = createClock();
  const unrouted: string[] = [];
  const fixtures = fixtureHandler([instantly], unrouted);

  // Every conversation comes back empty, so each reply has waited unanswered.
  // GET /leads/{id} answers with the lead the reply page's lookup named.
  const http = createFetch((request, index) => {
    const url = new URL(request.url);

    const byId = REPLIERS.find(
      (lead) => url.pathname === `/api/v2/leads/${lead.id}`
    );

    if (byId !== undefined) {
      return json(byId);
    }

    return url.pathname === "/api/v2/emails" &&
      url.searchParams.get("email_type") !== "received"
      ? json({ items: [] })
      : fixtures(request, index);
  });

  const outbound = createOutbound({
    adapter: instantly.make(),
    fetch: http.fetch,
    plugins: [insights()],
    rateLimitStore: new MemoryRateLimitStore(),
    runtime: clock.runtime,
    share: 1,
  });

  const result = await clock.settle(
    outbound.insights.droppedReplies({
      categories: ["neutral", "ooo"],
      older_than_hours: 0,
      since: "2026-01-01",
    })
  );

  const paths = http.requests.map((request) => new URL(request.url).pathname);

  assert.deepEqual(unrouted, []);
  assert.equal(result.data.dropped.length, 3);
  // One lookup per reply page for the leads' ids (OUT-149), then one read of
  // each waiting lead by that id.
  assert.equal(paths.filter((path) => path === "/api/v2/leads/list").length, 2);
  assert.equal(
    paths.filter((path) => /^\/api\/v2\/leads\/[0-9a-f-]+$/u.test(path)).length,
    3
  );
  assert.equal(
    paths.filter((path) => path.startsWith("/api/v2/campaigns/")).length,
    3
  );
  assert.equal(result.meta.requests, http.requests.length);

  // An Instantly reply names its lead by the lead's own ref (OUT-149).
  assert.deepEqual(
    result.data.dropped.map((each) => [each.lead, each.name, each.email]),
    [
      [
        "instantly:client-a:01a1d77f-5e65-78a7-8eb0-0216d691e16c",
        "Sam Sample",
        "person6@example.com",
      ],
      [
        "instantly:client-a:01a1d77f-5e65-78a7-8eb0-0216d691e16d",
        "Robin Sample",
        "person16@example.com",
      ],
      [
        "instantly:client-a:01a1d77f-5e65-78a7-8eb0-0216d691e16e",
        "Kim Sample",
        "person26@example.com",
      ],
    ]
  );

  for (const each of result.data.dropped) {
    assert.equal(each.campaignName, "My First Campaign");
  }
});

test("dropped_replies leaves the names null, with a note, when the tool cannot read one lead", async () => {
  const unnamed = await single(DATA, {
    "leads.get": false,
  }).insights.droppedReplies({}, { now: NOW });

  assert.deepEqual(
    unnamed.data.dropped.map((each) => [
      each.name,
      each.email,
      each.campaignName,
    ]),
    [
      [null, null, "Agency owners"],
      [null, null, "LinkedIn founders"],
    ]
  );
  assert.deepEqual(unnamed.meta.notes, [
    "This tool cannot read one lead (leads.get), so name, email and linkedinUrl are null.",
    "1 conversation of 5 could not be checked, so dropped counts only the 4 that were. totals.unchecked counts the rest, as neither dropped nor answered.",
  ]);
});

test("dropped_replies moves with older_than_hours, since, categories and include_auto", async () => {
  const outbound = single(DATA);

  const patient = await outbound.insights.droppedReplies(
    { older_than_hours: 31 },
    { now: NOW }
  );

  assert.deepEqual(
    patient.data.dropped.map((each) => each.reply),
    ["memory:agency:m2"]
  );
  assert.equal(patient.data.totals.tooRecent, 2);

  const eager = await outbound.insights.droppedReplies(
    { older_than_hours: 0 },
    { now: NOW }
  );

  assert.deepEqual(
    eager.data.dropped.map((each) => [each.reply, each.hoursWaiting]),
    [
      ["memory:agency:m2", 100],
      ["memory:agency:m6", 30.5],
      ["memory:agency:m7", 6],
    ]
  );

  const recent = await outbound.insights.droppedReplies(
    { since: "2026-11-12" },
    { now: NOW }
  );

  // Only the second reply of t1 is in range, so the wait is counted from it: 52 hours.
  assert.deepEqual(
    recent.data.dropped.map((each) => [
      each.reply,
      each.hoursWaiting,
      each.category,
    ]),
    [
      ["memory:agency:m3", 52, "unknown"],
      ["memory:agency:m6", 30.5, "positive"],
    ]
  );
  assert.equal(recent.data.since, "2026-11-12T00:00:00.000Z");
  assert.equal(recent.data.totals.repliesRead, 3);

  const everything = await outbound.insights.droppedReplies(
    {
      categories: ["negative", "ooo"],
      include_auto: true,
      since: "2026-10-01T00:00:00+00:00",
    },
    { now: NOW }
  );

  assert.deepEqual(
    everything.data.dropped.map((each) => [each.reply, each.category]),
    [
      ["memory:agency:m8", "ooo"],
      ["memory:agency:m9", "negative"],
    ]
  );
  assert.equal(everything.data.totals.repliesRead, 10);
  assert.equal(everything.data.totals.skippedByCategory, 8);

  const auto = await outbound.insights.droppedReplies(
    { categories: ["neutral"], include_auto: true },
    { now: NOW }
  );

  assert.deepEqual(
    auto.data.dropped.map((each) => each.reply),
    ["memory:agency:m10"]
  );
  assert.equal(auto.data.totals.skippedAuto, 0);
});

test("dropped_replies finds nothing when there are no replies", async () => {
  const result = await single({}).insights.droppedReplies({}, { now: NOW });

  assert.deepEqual(result.data.dropped, []);
  assert.deepEqual(result.data.totals, {
    answered: 0,
    conversations: 0,
    dropped: 0,
    moreRepliesExist: false,
    notInCampaign: null,
    repliesRead: 0,
    skippedAuto: 0,
    skippedByCategory: 0,
    tooRecent: 0,
    unchecked: 0,
  });
  assert.equal(result.meta.complete, true);
});

test("dropped_replies says the answer is partial when max_replies stops the read", async () => {
  const result = await single(DATA).insights.droppedReplies(
    { max_replies: 2 },
    { now: NOW }
  );

  // The two replies of t1.
  assert.equal(result.data.totals.repliesRead, 2);
  assert.equal(result.data.totals.moreRepliesExist, true);
  assert.equal(result.data.dropped.length, 1);
  assert.equal(result.meta.complete, false);
  assert.deepEqual(result.meta.notes, [
    "Stopped at 2 replies (max_replies); more exist.",
  ]);
});

test("dropped_replies is refused without a list of replies", async () => {
  await assert.rejects(
    async () =>
      await single(DATA, { "replies.list": false }).insights.droppedReplies({}),
    (error) =>
      OutboundError.is(error) &&
      error.code === "Unsupported" &&
      /replies\.list/u.test(error.message)
  );
});

test("dropped_replies falls back to the timeline without threads, and checks nothing without either", async () => {
  const noThreads = await single(DATA, {
    "messages.byThread": false,
  }).insights.droppedReplies({}, { now: NOW });

  // By lead: l1 is dropped, l2 was answered, l3's 6-hour-old reply is too recent, l4 is dropped.
  assert.deepEqual(
    noThreads.data.dropped.map((each) => [each.reply, each.checkedBy]),
    [
      ["memory:agency:m2", "timeline"],
      ["memory:agency:m6", "timeline"],
    ]
  );
  assert.equal(noThreads.data.totals.conversations, 5);
  assert.equal(noThreads.data.totals.unchecked, 1);

  const blind = await single(DATA, {
    "leads.timeline": false,
    "messages.byThread": false,
  }).insights.droppedReplies({}, { now: NOW });

  assert.deepEqual(blind.data.dropped, []);
  // Nine replies less two by category and one automatic leaves six, none of them readable.
  assert.equal(blind.data.totals.unchecked, 6);
  assert.equal(blind.data.totals.conversations, 6);
  assert.equal(blind.meta.complete, false);
  assert.deepEqual(blind.meta.notes, [
    "This tool can read neither a conversation nor a lead's timeline, so no reply could be checked.",
    "None of the 6 conversations could be checked, so dropped counts none of them. totals.unchecked counts them, as neither dropped nor answered.",
  ]);

  const noMessages = await single(DATA, {
    "messages.list": false,
  }).insights.droppedReplies({}, { now: NOW });

  assert.equal(noMessages.data.totals.unchecked, 6);
});

test("dropped_replies filters by date itself when the tool cannot", async () => {
  const result = await single(DATA, {
    "replies.since": false,
  }).insights.droppedReplies({}, { now: NOW });

  // The October reply is read, then left out.
  assert.equal(result.data.totals.repliesRead, 10);
  assert.equal(result.data.totals.dropped, 2);
  assert.equal(result.data.totals.conversations, 5);
  assert.deepEqual(result.meta.notes, [
    "This tool cannot filter replies by date, so the newest replies were read and filtered here.",
    "1 conversation of 5 could not be checked, so dropped counts only the 4 that were. totals.unchecked counts the rest, as neither dropped nor answered.",
  ]);
});

test("dropped_replies works across two tools, where a thread cannot be routed", async () => {
  const result = await agency().insights.droppedReplies(
    { since: "2026-11-01" },
    { now: NOW }
  );

  // The email reply on 5 November was followed by a send on the 6th.
  // The LinkedIn lead replied twice on the 3rd, after the only send on the 2nd:
  // 2026-11-03T09:00 to 2026-11-14T12:00 is 11 days and 3 hours.
  assert.deepEqual(
    result.data.dropped.map((each) => [
      each.reply,
      each.hoursWaiting,
      each.unansweredReplies,
      each.checkedBy,
      each.channel,
    ]),
    [["lntool:agency:d2", 267, 2, "timeline", "linkedin"]]
  );
  assert.equal(result.data.totals.answered, 1);
  assert.equal(result.meta.provider, "combined");
});

const waiting = (id: string): MemoryMessage => ({
  campaignId: "c1",
  direction: "in",
  id,
  leadId: id,
  sentAt: "2026-11-10T08:00:00.000Z",
  threadId: id,
});

test("dropped_replies writes the article the category takes", async () => {
  const result = await single({
    campaigns: [{ id: "c1" }],
    leads: [
      { campaignId: "c1", email: "person1@example.com", id: "u1" },
      { campaignId: "c1", email: "person2@example.com", id: "u2" },
    ],
    // u1 carries no category from the vendor: unknown.
    messages: [waiting("u1"), { ...waiting("u2"), category: "ooo" }],
  }).insights.droppedReplies({ categories: ["unknown", "ooo"] }, { now: NOW });

  assert.deepEqual(result.data.dropped.map((each) => each.finding).toSorted(), [
    "An ooo reply has waited 4 days with nothing sent after it.",
    "An unknown reply has waited 4 days with nothing sent after it.",
  ]);
});
