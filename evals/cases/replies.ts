// Replies and the hand-offs from them: cases 1-5, 7 and 8.

import type { Case, Verdict } from "../case.ts";
import { fail, firstFailure, pass, skip } from "../case.ts";
import type { Context } from "../context.ts";
import { at, bool, list, num, text } from "../json.ts";
import { codeOf, droppedItems, itemsOf, plural, unique } from "../shared.ts";

const latestIsAuto = (item: unknown): boolean =>
  at(item, "activity", "latest", "isAuto") === true;

const MEETING = /booked|completed|held|scheduled/u;

/**
 * Case 1: no listed conversation is automatic, totals.dropped counts the ones
 * that need a person, and it is null, never a false 0, while any conversation
 * went unchecked or more replies were left unread.
 */
export const judgeDroppedDefaults = (structured: unknown): Verdict => {
  const items = list(at(structured, "data", "dropped"));
  const totals = at(structured, "data", "totals");
  const total = num(at(totals, "dropped"));
  const unchecked = num(at(totals, "unchecked")) ?? 0;
  const unread = at(totals, "moreRepliesExist") === true;
  const auto = items.filter(latestIsAuto).length;

  const needed = items.filter(
    (item) => at(item, "followUp", "needed") === true
  ).length;

  const complete = bool(at(structured, "meta", "complete"));

  // owed is what was found: a lower bound when the check is incomplete.
  const truth = {
    complete,
    listed: items.length,
    owed: needed,
    unchecked,
  };

  const partial = unchecked > 0 || unread;

  return firstFailure(
    [
      total === null && !partial
        ? "dropped_replies gave no totals.dropped over a full check"
        : null,
      total !== null && partial
        ? `totals.dropped is ${total} while ${unchecked} conversations went unchecked${unread ? " and more replies exist" : ""}`
        : null,
      auto > 0
        ? `${auto} of ${items.length} listed conversations end in an automatic reply`
        : null,
      total !== null && total !== needed
        ? `totals.dropped is ${total}, but ${needed} listed items have followUp.needed: true`
        : null,
    ],
    `${plural(items.length, "conversation")} listed, none automatic, totals.dropped ${total === null ? "null over an incomplete check" : "matches"}`,
    truth
  );
};

/** Case 2: a reply flagged automatic is never listed as a positive reply. */
export const judgePositiveReplies = (structured: unknown): Verdict => {
  const replies = list(at(structured, "data", "replies"));

  const auto = replies.filter(
    (reply) => at(reply, "is_auto") === true || at(reply, "isAuto") === true
  ).length;

  return auto > 0
    ? fail(
        `${auto} of ${replies.length} positive replies are flagged automatic`
      )
    : pass(`${plural(replies.length, "positive reply")} read, none automatic`);
};

/** Case 3: followUp.needed is true only for an inbound, human latest message with no meeting. */
export const judgeFollowUpRule = (items: readonly unknown[]): Verdict => {
  const needed = items.filter(
    (item) => at(item, "followUp", "needed") === true
  );

  const wrong = needed.filter((item) => {
    const direction = text(at(item, "activity", "latest", "direction"));
    const meeting = text(at(item, "meeting")) ?? "";

    return direction !== "in" || latestIsAuto(item) || MEETING.test(meeting);
  }).length;

  if (needed.length === 0) {
    return skip(
      `none of ${plural(items.length, "conversation")} has followUp.needed: true`
    );
  }

  return wrong > 0
    ? fail(
        `${wrong} of ${needed.length} conversations marked needed are not an inbound human reply without a meeting`
      )
    : pass(
        `${plural(needed.length, "conversation")} marked needed, each inbound, human and without a meeting`
      );
};

const REFUSED =
  /refus|unknown|unsupported|not one of|cannot|stale|token|not read by/iu;

/** Case 4: every ref dropped_replies hands on is accepted by thread_context. */
export const judgeHandOff = (
  structured: unknown,
  isError: boolean,
  code: string | null,
  asked: number
): Verdict => {
  if (isError) {
    return fail(
      `thread_context refused ${plural(asked, "ref")} from dropped_replies with ${code ?? "an error"}`
    );
  }

  const refused = list(at(structured, "data", "coverage", "notFound")).filter(
    (miss) => REFUSED.test(text(at(miss, "reason")) ?? "")
  ).length;

  return refused > 0
    ? fail(
        `thread_context refused ${refused} of ${plural(asked, "ref")} dropped_replies returned`
      )
    : pass(
        `thread_context accepted all ${plural(asked, "ref")} dropped_replies returned`
      );
};

/** Case 5: unchecked targets make the answer incomplete, and reads are counted. */
export const judgeCoverage = (structured: unknown): Verdict => {
  const unchecked = list(
    at(structured, "data", "coverage", "unchecked")
  ).length;

  const checked = num(at(structured, "data", "coverage", "checked")) ?? 0;
  const complete = bool(at(structured, "meta", "complete"));
  const requests = num(at(structured, "meta", "requests"));

  return firstFailure(
    [
      unchecked > 0 && complete !== false
        ? `${unchecked} targets unchecked, but meta.complete is ${String(complete)}`
        : null,
      checked > 0 && (requests ?? 0) === 0
        ? `${checked} targets read with meta.requests ${String(requests)}`
        : null,
    ],
    `${checked} checked, ${unchecked} unchecked, complete ${String(complete)}, ${String(requests)} requests`
  );
};

/** Case 7: a lead reply_samples shows replying always has messages in thread_context. */
export const judgeRepliedHasMessages = (
  structured: unknown,
  asked: number
): Verdict => {
  const threads = list(at(structured, "data", "threads"));

  const empty = threads.filter(
    (thread) =>
      text(at(thread, "followUp", "basis")) === "no_messages" ||
      num(at(thread, "activity", "messagesRead")) === 0
  ).length;

  const noMessages = list(
    at(structured, "data", "coverage", "notFound")
  ).filter((miss) =>
    /no messages/iu.test(text(at(miss, "reason")) ?? "")
  ).length;

  const bad = Math.max(empty, noMessages);

  return bad > 0
    ? fail(
        `${bad} of ${plural(asked, "lead")} with a reply read with no messages in thread_context`
      )
    : pass(
        `all ${plural(asked, "lead")} with a reply have messages in thread_context`
      );
};

/** Case 8: every reply's leadRef is a lead of the same provider and workspace, or null with a note. */
export const judgeReplyLeadJoin = (
  replies: readonly {
    readonly provider: string;
    readonly workspaceId: string;
    readonly leadRef: string | null;
  }[],
  found: ReadonlySet<string>,
  notes: readonly string[]
): Verdict => {
  const nulls = replies.filter((reply) => reply.leadRef === null).length;

  const foreign = replies.filter(
    (reply) =>
      reply.leadRef !== null &&
      !reply.leadRef.startsWith(`${reply.provider}:${reply.workspaceId}:`)
  ).length;

  const refs = unique(
    replies.flatMap((reply) => (reply.leadRef === null ? [] : [reply.leadRef]))
  );

  const missing = refs.filter((ref) => !found.has(ref)).length;

  return firstFailure(
    [
      foreign > 0
        ? `${foreign} of ${plural(replies.length, "reply")} carry a leadRef from another provider or workspace`
        : null,
      missing > 0
        ? `${missing} of ${plural(refs.length, "leadRef")} do not read back as a lead`
        : null,
      nulls > 0 && notes.length === 0
        ? `${nulls} replies have a null leadRef and no note says why`
        : null,
    ],
    `${plural(refs.length, "leadRef")} from ${plural(replies.length, "reply")} all read back as leads`
  );
};

const strings = (values: readonly unknown[]): string[] =>
  values.filter((value): value is string => typeof value === "string");

const handOffTargets = async (
  ctx: Context
): Promise<{ readonly leads: string[]; readonly threads: string[] }> => {
  const { items } = await droppedItems(ctx);

  return {
    leads: unique(strings(items.map((item) => at(item, "lead")))).slice(0, 5),
    threads: unique(
      strings(items.flatMap((item) => list(at(item, "threadIds"))))
    ).slice(0, 5),
  };
};

const handOffRead = async (ctx: Context) => {
  const targets = await handOffTargets(ctx);
  const asked = targets.leads.length + targets.threads.length;

  if (asked === 0) {
    return { asked, outcome: undefined };
  }

  return { asked, outcome: await ctx.mcp().call("thread_context", targets) };
};

/** Leads reply_samples shows replying, or the code it answered with. */
const repliedLeads = async (ctx: Context): Promise<string[] | string> => {
  const samples = await ctx.mcp().call("reply_samples");

  if (samples.isError) {
    return codeOf(samples);
  }

  return unique(
    strings(itemsOf(samples, "replies").map((reply) => at(reply, "lead")))
  ).slice(0, 5);
};

export const REPLY_CASES: readonly Case[] = [
  {
    id: 1,
    issue: "OUT-146",
    p1: true,
    run: async (ctx) => {
      const outcome = await ctx.mcp().call("dropped_replies");

      return outcome.isError
        ? fail(`dropped_replies answered ${codeOf(outcome)}`)
        : judgeDroppedDefaults(outcome.structured);
    },
    title: "dropped_replies defaults",
  },
  {
    id: 2,
    issue: "OUT-146",
    p1: true,
    run: async (ctx) => {
      const outcome = await ctx
        .mcp()
        .call("reply_samples", { category: "positive", limit: 50 });

      return outcome.isError
        ? fail(`reply_samples answered ${codeOf(outcome)}`)
        : judgePositiveReplies(outcome.structured);
    },
    title: "positive replies",
  },
  {
    id: 3,
    issue: "OUT-146",
    p1: true,
    run: async (ctx) => judgeFollowUpRule((await droppedItems(ctx)).items),
    title: "positive label alone",
  },
  {
    id: 4,
    issue: "OUT-151",
    p1: true,
    run: async (ctx) => {
      const { asked, outcome } = await handOffRead(ctx);

      return outcome === undefined
        ? skip("dropped_replies listed no conversation to hand on")
        : judgeHandOff(
            outcome.structured,
            outcome.isError,
            outcome.code,
            asked
          );
    },
    title: "dropped → thread_context",
  },
  {
    id: 5,
    issue: "OUT-151",
    p1: true,
    run: async (ctx) => {
      const { outcome } = await handOffRead(ctx);

      if (outcome === undefined || outcome.isError) {
        return skip("no thread_context answer to check");
      }

      return judgeCoverage(outcome.structured);
    },
    title: "thread_context coverage",
  },
  {
    id: 7,
    issue: "OUT-149",
    p1: true,
    run: async (ctx) => {
      const leads = await repliedLeads(ctx);

      if (typeof leads === "string") {
        return fail(
          `reply_samples answered ${leads}, so no lead could be handed on`
        );
      }

      if (leads.length === 0) {
        return skip("reply_samples listed no reply with a lead");
      }

      const outcome = await ctx.mcp().call("thread_context", { leads });

      return outcome.isError
        ? fail(
            `thread_context answered ${codeOf(outcome)} for leads reply_samples returned`
          )
        : judgeRepliedHasMessages(outcome.structured, leads.length);
    },
    title: "reply_samples → thread_context",
  },
  {
    id: 8,
    issue: "OUT-149",
    p1: true,
    run: async (ctx) => {
      const outbound = await ctx.sdk();
      const page = await ctx.settle(outbound.replies.list({ limit: 25 }));
      ctx.budget.spend(page.meta.requests);

      const replies = page.items.map((reply) => ({
        leadRef: reply.leadRef ?? null,
        provider: reply.provider,
        workspaceId: reply.workspaceId,
      }));

      const found = new Set<string>();

      const checked = unique(
        strings(replies.map((reply) => reply.leadRef))
      ).slice(0, 10);

      for (const ref of checked) {
        ctx.budget.check();

        try {
          const lead = await ctx.settle(outbound.leads.get(ref));
          ctx.budget.spend(lead.meta.requests);
          found.add(ref);
        } catch {
          ctx.budget.spend(1);
        }
      }

      if (replies.length === 0) {
        return skip("no replies to join");
      }

      return judgeReplyLeadJoin(
        replies.filter(
          (reply) => reply.leadRef === null || checked.includes(reply.leadRef)
        ),
        found,
        page.meta.notes
      );
    },
    title: "reply-to-lead join",
  },
];
