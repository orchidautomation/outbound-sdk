import assert from "node:assert/strict";
import { test } from "node:test";

import { combine } from "../../src/combine/index.ts";
import { createOutbound, OutboundError } from "../../src/index.ts";
import type { Adapter } from "../../src/index.ts";
import { insights } from "../../src/insights/index.ts";
import { memory } from "../../src/memory/index.ts";
import type { MemoryData, MemoryMessage } from "../../src/memory/index.ts";
import { ref } from "./copy-helpers.ts";
import { NOW, single } from "./helpers.ts";

const message = (
  id: string,
  direction: "in" | "out",
  sentAt: string,
  rest: Partial<MemoryMessage> = {}
): MemoryMessage => ({ campaignId: "c1", direction, id, sentAt, ...rest });

// 2026-11-02 is a Monday. NOW is Saturday 2026-11-14 12:00 UTC.
const MESSAGES: readonly MemoryMessage[] = [
  // Outside the default 30 days.
  message("old1", "out", "2026-10-01T09:00:00.000Z", { leadId: "l6" }),
  message("old2", "in", "2026-10-02T09:00:00.000Z", { leadId: "l6" }),
  // Thread t1: answered in half an hour, then a second message nobody prompted.
  message("a1", "out", "2026-11-02T09:00:00.000Z", {
    leadId: "l1",
    threadId: "t1",
  }),
  message("a2", "in", "2026-11-02T09:30:00.000Z", {
    leadId: "l1",
    threadId: "t1",
  }),
  message("a3", "in", "2026-11-02T10:00:00.000Z", {
    leadId: "l1",
    threadId: "t1",
  }),
  // Thread t2: Tuesday 14:00 to Wednesday 10:00 is 20 hours.
  message("b1", "out", "2026-11-03T14:00:00.000Z", {
    leadId: "l2",
    threadId: "t2",
  }),
  message("b2", "in", "2026-11-04T10:00:00.000Z", {
    leadId: "l2",
    threadId: "t2",
  }),
  // No thread id: matched on the lead, against the later of two sends. 24 hours.
  message("c1", "out", "2026-11-04T08:00:00.000Z", { leadId: "l3" }),
  message("c2", "out", "2026-11-06T08:00:00.000Z", { leadId: "l3" }),
  message("c3", "in", "2026-11-07T08:00:00.000Z", { leadId: "l3" }),
  // Thread t4: Thursday 16:00 to Monday 16:00 is 96 hours.
  message("d1", "out", "2026-11-05T16:00:00.000Z", {
    leadId: "l4",
    threadId: "t4",
  }),
  message("d2", "in", "2026-11-09T16:00:00.000Z", {
    leadId: "l4",
    threadId: "t4",
  }),
  // A reply to a send that was not read, and one with nothing to match on.
  message("e1", "in", "2026-11-10T11:00:00.000Z", {
    leadId: "l9",
    threadId: "t9",
  }),
  message("e2", "in", "2026-11-10T23:30:00.000Z"),
  // The send has no thread id, the reply has: matched on the lead. 3 hours.
  message("f1", "out", "2026-11-11T09:00:00.000Z", { leadId: "l5" }),
  message("f2", "in", "2026-11-11T12:00:00.000Z", {
    leadId: "l5",
    threadId: "t5",
  }),
  // Another campaign: six minutes, 0.1 hours.
  message("g1", "out", "2026-11-12T10:00:00.000Z", {
    campaignId: "c2",
    leadId: "l7",
    threadId: "t7",
  }),
  message("g2", "in", "2026-11-12T10:06:00.000Z", {
    campaignId: "c2",
    leadId: "l7",
    threadId: "t7",
  }),
];

const DATA: MemoryData = {
  campaigns: [{ id: "c1" }, { id: "c2" }],
  messages: MESSAGES,
};

/** The note for replies that carry no auto flag, which are counted as replies. */
const unflagged = (count: number, of: number): string =>
  `${count} of ${of} replies carry no auto flag, so an automatic one among them is counted as a reply. A fast median can be auto-replies.`;

const INCLUDE_AUTO_NOTE =
  "Automatic replies such as out-of-office messages are counted as replies (include_auto). A fast median can be auto-replies.";

const counted = <Entry extends { readonly count: number }>(
  entries: readonly Entry[]
): Entry[] => entries.filter((entry) => entry.count > 0);

test("reply_timing times each reply from the send it answers and says when replies arrive", async () => {
  const result = await single(DATA).insights.replyTiming({}, { now: NOW });

  assert.equal(result.insight, "reply_timing");
  assert.equal(result.meta.complete, true);
  assert.equal(result.data.campaign, null);
  // 30 days before NOW.
  assert.equal(result.data.since, "2026-10-15T12:00:00.000Z");

  // Hours, sorted: 0.1, 0.5, 3, 20, 24, 96.
  assert.deepEqual(result.data.timeToReply, {
    // Halfway between 3 and 20.
    medianHours: 11.5,
    // Position 3.75: 20 + 0.75 * (24 - 20).
    p75Hours: 23,
    // Position 4.5: 24 + 0.5 * (96 - 24).
    p90Hours: 60,
    sample: 6,
    // 0.1 and 0.5 of six.
    within1Hour: 0.3333,
    // Five of six; the reply at exactly 24 hours counts.
    within24Hours: 0.8333,
    within72Hours: 0.8333,
  });
  assert.deepEqual(result.data.counts, {
    autoReplies: 0,
    followOnReplies: 1,
    messagesRead: 16,
    paired: 6,
    received: 9,
    sent: 7,
    unpaired: 2,
    // Under a quarter, so the answer is not marked partial.
    unpairedShare: 0.2222,
  });

  // All nine replies: Monday 3, Tuesday 2, Wednesday 2, Thursday 1, Saturday 1.
  assert.deepEqual(
    result.data.replies.byWeekday.map((day) => [
      day.weekday,
      day.count,
      day.share,
    ]),
    [
      ["Monday", 3, 0.3333],
      ["Tuesday", 2, 0.2222],
      ["Wednesday", 2, 0.2222],
      ["Thursday", 1, 0.1111],
      ["Friday", 0, 0],
      ["Saturday", 1, 0.1111],
      ["Sunday", 0, 0],
    ]
  );
  assert.equal(result.data.replies.byHour.length, 24);
  assert.deepEqual(
    counted(result.data.replies.byHour).map((hour) => [hour.hour, hour.count]),
    [
      [8, 1],
      [9, 1],
      [10, 3],
      [11, 1],
      [12, 1],
      [16, 1],
      [23, 1],
    ]
  );
  assert.equal(result.data.replies.byHour[10]?.share, 0.3333);
  assert.deepEqual(
    [result.data.replies.topWeekday, result.data.replies.topHour],
    ["Monday", 10]
  );

  // The six sends that were answered: the Friday one for lead l3, not the Wednesday one.
  assert.deepEqual(
    counted(result.data.sendsThatDrewReplies.byWeekday).map((day) => [
      day.weekday,
      day.count,
    ]),
    [
      ["Monday", 1],
      ["Tuesday", 1],
      ["Wednesday", 1],
      ["Thursday", 2],
      ["Friday", 1],
    ]
  );
  assert.deepEqual(
    counted(result.data.sendsThatDrewReplies.byHour).map((hour) => [
      hour.hour,
      hour.count,
    ]),
    [
      [8, 1],
      [9, 2],
      [10, 1],
      [14, 1],
      [16, 1],
    ]
  );
  assert.deepEqual(
    [
      result.data.sendsThatDrewReplies.topWeekday,
      result.data.sendsThatDrewReplies.topHour,
    ],
    ["Thursday", 9]
  );
});

test("reply_timing narrows to one campaign, moves with since and shifts the clock with the offset", async () => {
  const outbound = single(DATA);

  // Campaign c1 alone: 0.5, 3, 20, 24, 96.
  const one = await outbound.insights.replyTiming(
    { campaign: ref("c1") },
    { now: NOW }
  );

  assert.deepEqual(
    [
      one.data.campaign,
      one.data.timeToReply.sample,
      one.data.timeToReply.medianHours,
      one.data.timeToReply.p75Hours,
      // Position 3.6: 24 + 0.6 * 72.
      one.data.timeToReply.p90Hours,
      one.data.timeToReply.within1Hour,
      one.data.timeToReply.within24Hours,
      one.data.counts.unpaired,
    ],
    [ref("c1"), 5, 20, 24, 67.2, 0.2, 0.8, 2]
  );

  // From 10 November on: the 3 hour and the 0.1 hour replies. An offset in the input is honoured.
  const late = await outbound.insights.replyTiming(
    { since: "2026-11-10T02:00:00+02:00" },
    { now: NOW }
  );

  assert.deepEqual(
    [
      late.data.since,
      late.data.timeToReply.sample,
      late.data.timeToReply.medianHours,
      late.data.counts.messagesRead,
      late.data.counts.unpaired,
    ],
    ["2026-11-10T00:00:00.000Z", 2, 1.55, 6, 2]
  );

  // Further back, the October pair (24 hours) is read too: 0.1, 0.5, 3, 20, 24, 24, 96.
  const early = await outbound.insights.replyTiming(
    { since: "2026-09-30T00:00:00Z" },
    { now: NOW }
  );

  assert.deepEqual(
    [early.data.timeToReply.sample, early.data.timeToReply.medianHours],
    [7, 20]
  );

  // Two hours ahead of UTC, Tuesday 23:30 becomes Wednesday 01:30.
  const shifted = await outbound.insights.replyTiming(
    { timezone_offset_minutes: 120 },
    { now: NOW }
  );

  assert.equal(shifted.data.timezoneOffsetMinutes, 120);
  assert.deepEqual(
    shifted.data.replies.byWeekday.slice(1, 3).map((day) => day.count),
    [1, 3]
  );
  assert.deepEqual(
    counted(shifted.data.replies.byHour).map((hour) => [hour.hour, hour.count]),
    [
      [1, 1],
      [10, 1],
      [11, 1],
      [12, 3],
      [13, 1],
      [14, 1],
      [18, 1],
    ]
  );
  assert.equal(shifted.data.replies.topHour, 12);
  // The time to reply does not depend on the clock.
  assert.equal(shifted.data.timeToReply.medianHours, 11.5);
});

test("reply_timing with no messages returns unknowns, not zeros", async () => {
  const result = await single({
    campaigns: [{ id: "c1" }],
  }).insights.replyTiming({}, { now: NOW });

  assert.deepEqual(result.data.timeToReply, {
    medianHours: null,
    p75Hours: null,
    p90Hours: null,
    sample: 0,
    within1Hour: null,
    within24Hours: null,
    within72Hours: null,
  });
  assert.deepEqual(
    [result.data.replies.topWeekday, result.data.replies.topHour],
    [null, null]
  );
  assert.ok(result.data.replies.byWeekday.every((day) => day.share === null));
  assert.deepEqual(result.data.counts, {
    autoReplies: 0,
    followOnReplies: 0,
    messagesRead: 0,
    paired: 0,
    received: 0,
    sent: 0,
    unpaired: 0,
    unpairedShare: null,
  });
});

test("reply_timing counts a reply with no time as unpaired", async () => {
  const base = memory({ data: DATA, workspaceId: "agency" });

  // The seed data cannot hold a message with no time, so the adapter drops one here.
  const adapter: Adapter = {
    ...base,
    listMessages: async (query, ctx) => {
      const page = await base.listMessages?.(query, ctx);

      return {
        ...page,
        items: (page?.items ?? []).map((each) =>
          each.sourceId === "g2" ? { ...each, sentAt: null } : each
        ),
      };
    },
  };

  const result = await createOutbound({
    adapter,
    plugins: [insights()],
  }).insights.replyTiming({}, { now: NOW });

  assert.deepEqual(
    [
      result.data.counts.received,
      result.data.counts.paired,
      result.data.counts.unpaired,
      result.data.timeToReply.sample,
    ],
    [9, 5, 3, 5]
  );
  // Eight replies have a time to place them by.
  assert.equal(result.data.replies.byHour[10]?.count, 2);
});

test("reply_timing stops at max_messages and says the answer is partial", async () => {
  const result = await single(DATA).insights.replyTiming(
    { max_messages: 5 },
    { now: NOW }
  );

  // The first five from 15 October on: a1, a2, a3, b1, b2.
  assert.equal(result.data.counts.messagesRead, 5);
  assert.deepEqual(
    [result.data.timeToReply.sample, result.data.timeToReply.medianHours],
    // 0.5 and 20.
    [2, 10.25]
  );
  assert.equal(result.meta.complete, false);
  assert.deepEqual(result.meta.notes, [
    "Stopped at 5 messages (max_messages); more exist.",
    unflagged(3, 3),
  ]);
});

test("reply_timing is refused without messages, and filters by date itself when the tool cannot", async () => {
  await assert.rejects(
    single(DATA, { "messages.list": false }).insights.replyTiming(
      {},
      { now: NOW }
    ),
    (error) =>
      error instanceof OutboundError &&
      error.code === "Unsupported" &&
      error.message.includes("messages.list")
  );

  await assert.rejects(
    single(DATA).insights.replyTiming({ since: "yesterday" }, { now: NOW }),
    (error) => error instanceof OutboundError && error.code === "Invalid"
  );

  const unfiltered = await single(DATA, {
    "messages.since": false,
  }).insights.replyTiming({}, { now: NOW });

  // All 18 are read; the two from October are dropped here.
  assert.deepEqual(
    [
      unfiltered.data.counts.messagesRead,
      unfiltered.data.timeToReply.sample,
      unfiltered.data.timeToReply.medianHours,
    ],
    [16, 6, 11.5]
  );
  assert.deepEqual(unfiltered.meta.notes, [
    "This tool cannot filter messages by date, so the cap applies to all messages and older ones were dropped after reading.",
    unflagged(9, 9),
  ]);
});

test("reply_timing reads email and LinkedIn together on a combined instance", async () => {
  const outbound = createOutbound({
    adapter: combine([
      memory({ data: DATA, name: "mailtool", workspaceId: "agency" }),
      memory({
        data: {
          campaigns: [{ channel: "linkedin", id: "k1" }],
          messages: [
            // The same lead id and thread id as the email tool's l1 and t1, sent between
            // that thread's send and its reply: the two conversations must stay apart.
            message("x1", "out", "2026-11-02T09:10:00.000Z", {
              campaignId: "k1",
              leadId: "l1",
              threadId: "t1",
            }),
            // Two hours.
            message("x2", "in", "2026-11-02T11:10:00.000Z", {
              campaignId: "k1",
              leadId: "l1",
              threadId: "t1",
            }),
          ],
        },
        name: "lntool",
        workspaceId: "agency",
      }),
    ]),
    plugins: [insights()],
  });

  const all = await outbound.insights.replyTiming({}, { now: NOW });

  // 0.1, 0.5, 2, 3, 20, 24, 96.
  assert.deepEqual(
    [
      all.data.timeToReply.sample,
      all.data.timeToReply.medianHours,
      all.data.counts.messagesRead,
      all.data.counts.followOnReplies,
    ],
    [7, 3, 18, 1]
  );

  const linkedin = await outbound.insights.replyTiming(
    { campaign: ref("k1", "lntool") },
    { now: NOW }
  );

  assert.deepEqual(
    [linkedin.data.timeToReply.sample, linkedin.data.timeToReply.medianHours],
    [1, 2]
  );
});

test("reply_timing leaves replies flagged automatic out, and counts them with include_auto (OUT-75, OUT-92)", async () => {
  // 8 out-of-office replies two minutes after the send, 2 people two days later.
  const messages: MemoryMessage[] = Array.from({ length: 10 }, (_, index) => {
    const day = String(2 + index).padStart(2, "0");
    const sent = `2026-11-${day}T09:00:00.000Z`;

    return [
      { direction: "out", id: `o${index}`, leadId: `l${index}`, sentAt: sent },
      {
        direction: "in",
        id: `i${index}`,
        isAuto: index < 8,
        leadId: `l${index}`,
        sentAt:
          index < 8
            ? `2026-11-${day}T09:02:00.000Z`
            : `2026-11-${String(4 + index).padStart(2, "0")}T15:00:00.000Z`,
      },
    ] as const;
  }).flat();

  const outbound = single({
    campaigns: [{ id: "c1" }],
    messages: messages.map((each) => ({ ...each, campaignId: "c1" })),
  });

  const result = await outbound.insights.replyTiming({}, { now: NOW });

  // Flagged automatic, the 8 are left out: only the 2 people are timed.
  assert.equal(result.data.timeToReply.sample, 2);
  assert.equal(result.data.timeToReply.within1Hour, 0);
  assert.equal(result.data.counts.autoReplies, 8);
  assert.deepEqual(result.meta.notes, []);
  assert.equal(result.meta.complete, true);

  const all = await outbound.insights.replyTiming(
    { include_auto: true },
    { now: NOW }
  );

  assert.equal(all.data.timeToReply.within1Hour, 0.8);
  assert.equal(all.data.counts.autoReplies, 0);
  assert.deepEqual(all.meta.notes, [INCLUDE_AUTO_NOTE]);
});

test("reply_timing marks the answer partial when many replies answer a send from before since (OUT-75)", async () => {
  // Four people emailed on 10-10, before the 30 days read, replied 11-01 to
  // 11-04; one more was emailed and replied within the hour on 11-10.
  const messages: MemoryMessage[] = [
    ...[1, 2, 3, 4].flatMap((person) => [
      {
        direction: "out" as const,
        id: `o${person}`,
        leadId: `l${person}`,
        sentAt: "2026-10-10T09:00:00.000Z",
      },
      {
        direction: "in" as const,
        id: `i${person}`,
        leadId: `l${person}`,
        sentAt: `2026-11-0${person}T09:00:00.000Z`,
      },
    ]),
    {
      direction: "out",
      id: "o9",
      leadId: "l9",
      sentAt: "2026-11-10T09:00:00.000Z",
    },
    {
      direction: "in",
      id: "i9",
      leadId: "l9",
      sentAt: "2026-11-10T10:00:00.000Z",
    },
  ];

  const result = await single({
    campaigns: [{ id: "c" }],
    messages,
  }).insights.replyTiming({}, { now: NOW });

  assert.equal(result.data.timeToReply.sample, 1);
  assert.equal(result.data.counts.unpaired, 4);
  assert.equal(result.data.counts.unpairedShare, 0.8);
  assert.equal(result.meta.complete, false);
  assert.deepEqual(result.meta.notes, [
    "4 of 5 replies (80%) were not paired with a send, often because the send went out before since. Time to reply leaves them out, so it may look faster than it is; set since earlier to pair more.",
    unflagged(5, 5),
  ]);

  // From 10-01 every reply pairs, and the slow ones count.
  const earlier = await single({
    campaigns: [{ id: "c" }],
    messages,
  }).insights.replyTiming({ since: "2026-10-01T00:00:00Z" }, { now: NOW });

  assert.equal(earlier.data.counts.unpaired, 0);
  assert.equal(earlier.data.counts.unpairedShare, 0);
  assert.equal(earlier.meta.complete, true);
});
