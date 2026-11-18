// Every invariant's judge, with an accepted and a rejected case.

import assert from "node:assert/strict";
import { test } from "node:test";

import {
  judgeCapped,
  judgeEmptyFiltered,
  judgeHeadline,
  judgeProvidersLeftOut,
} from "../cases/coverage.ts";
import {
  judgeDailySums,
  judgeMeetings,
  judgeMissingDays,
  judgeSync,
  judgeTruncation,
  judgeVariantTest,
} from "../cases/data.ts";
import {
  judgeIdentity,
  judgePersonReconcile,
  judgeRedactParity,
  judgeRepliedSources,
} from "../cases/people.ts";
import {
  judgeCoverage,
  judgeDroppedDefaults,
  judgeFollowUpRule,
  judgeHandOff,
  judgePositiveReplies,
  judgeRepliedHasMessages,
  judgeReplyLeadJoin,
} from "../cases/replies.ts";
import { judgeRunway, judgeRunwayAgreement } from "../cases/runway.ts";
import {
  hintedTools,
  judgeCatalogParity,
  judgeDefaults,
  judgeNextHints,
  judgeProgress,
  judgeProvenance,
  judgeRequestCap,
  judgeSurfaceSize,
  judgeTimeBudget,
  LIST_BUDGET_BYTES,
} from "../cases/surface.ts";
import type { CallOutcome } from "../session.ts";

const human = {
  activity: { latest: { direction: "in", isAuto: false } },
  followUp: { needed: true },
  meeting: null,
};

const auto = {
  activity: { latest: { direction: "in", isAuto: true } },
  followUp: { needed: null },
  meeting: null,
};

const dropped = (items: unknown[], total: number) => ({
  data: { dropped: items, totals: { dropped: total, unchecked: 0 } },
  meta: { complete: true },
});

const outcome = (fields: Partial<CallOutcome>): CallOutcome => ({
  code: null,
  complete: true,
  contentBytes: 100,
  firstProgressMs: null,
  isError: false,
  ms: 1000,
  name: "tool",
  requests: 1,
  structured: {},
  structuredBytes: 1000,
  ...fields,
});

const verdicts = (
  pairs: Record<string, [{ status: string }, { status: string }]>
): void => {
  for (const [name, [accepted, rejected]] of Object.entries(pairs)) {
    test(`${name}: accepts the invariant and rejects its breach`, () => {
      assert.equal(accepted.status, "pass", name);
      assert.equal(rejected.status, "fail", name);
    });
  }
};

verdicts({
  "1 dropped_replies defaults": [
    judgeDroppedDefaults(dropped([human], 1)),
    judgeDroppedDefaults(dropped([human, auto], 2)),
  ],
  "2 positive replies": [
    judgePositiveReplies({ data: { replies: [{ is_auto: false }] } }),
    judgePositiveReplies({ data: { replies: [{ is_auto: true }] } }),
  ],
  "3 positive label alone": [
    judgeFollowUpRule([human]),
    judgeFollowUpRule([{ ...human, meeting: "booked" }]),
  ],
  "4 dropped → thread_context": [
    judgeHandOff(
      {
        data: {
          coverage: { notFound: [{ reason: "read, with no messages" }] },
        },
      },
      false,
      null,
      2
    ),
    judgeHandOff(
      {
        data: {
          coverage: { notFound: [{ reason: "an unknown redact token" }] },
        },
      },
      false,
      null,
      2
    ),
  ],
  "5 thread_context coverage": [
    judgeCoverage({
      data: { coverage: { checked: 2, unchecked: [{}] } },
      meta: { complete: false, requests: 3 },
    }),
    judgeCoverage({
      data: { coverage: { checked: 2, unchecked: [{}] } },
      meta: { complete: true, requests: 0 },
    }),
  ],
  "6 defaults under default flags": [
    judgeDefaults([outcome({ code: "Invalid", isError: true })]),
    judgeDefaults([outcome({ code: "Unsupported", isError: true })]),
  ],
  "7 reply_samples → thread_context": [
    judgeRepliedHasMessages(
      {
        data: {
          coverage: { notFound: [] },
          threads: [
            { activity: { messagesRead: 2 }, followUp: { basis: "answered" } },
          ],
        },
      },
      1
    ),
    judgeRepliedHasMessages(
      {
        data: {
          coverage: { notFound: [] },
          threads: [
            {
              activity: { messagesRead: 0 },
              followUp: { basis: "no_messages" },
            },
          ],
        },
      },
      1
    ),
  ],
  "8 reply-to-lead join": [
    judgeReplyLeadJoin(
      [{ leadRef: "instantly:w:1", provider: "instantly", workspaceId: "w" }],
      new Set(["instantly:w:1"]),
      []
    ),
    judgeReplyLeadJoin(
      [{ leadRef: "instantly:w:a@b", provider: "instantly", workspaceId: "w" }],
      new Set(),
      []
    ),
  ],
  "9 runway": [
    judgeRunway([
      { daysLeft: 5, pace: 10, remaining: 50, state: "draining" },
      { daysLeft: null, pace: 0, remaining: 9, state: "stalled" },
    ]),
    judgeRunway([{ daysLeft: 0, pace: null, remaining: 9, state: "stalled" }]),
  ],
  "10 runway agreement": [
    judgeRunwayAgreement([
      {
        report: { daysLeft: 3, pace: 1, remaining: 3, state: "draining" },
        reportComplete: true,
        tool: { daysLeft: 3, pace: 1, remaining: 3, state: "draining" },
        toolComplete: true,
      },
    ]),
    judgeRunwayAgreement([
      {
        report: { daysLeft: 0, pace: 1, remaining: 0, state: "out_of_leads" },
        reportComplete: true,
        tool: { daysLeft: 3, pace: 1, remaining: 3, state: "draining" },
        toolComplete: true,
      },
    ]),
  ],
  "11/12 capped safety checks": [
    judgeCapped(
      "suppression_check",
      {
        complete: false,
        finding: "At least 2 found; the check is incomplete",
        found: 2,
      },
      { complete: false, finding: "At least 3", found: 3 }
    ),
    judgeCapped(
      "suppression_check",
      { complete: false, finding: "No lead is on the block list.", found: 0 },
      { complete: true, finding: "17 found", found: 17 }
    ),
  ],
  "13 providers left out": [
    judgeProvidersLeftOut(
      ["instantly", "heyreach"],
      ["instantly"],
      '[{"provider":"heyreach"}]'
    ),
    judgeProvidersLeftOut(["instantly", "heyreach"], ["instantly"], "[]"),
  ],
  "14 headline totals": [
    judgeHeadline(
      {
        data: {
          campaigns: [{ current: { sent: 5 } }],
          tooFewSends: [{ currentSent: 1 }],
          total: { current: { sent: 6 } },
          totalBasis: { covers: "campaigns", description: "active" },
        },
      },
      9
    ),
    judgeHeadline(
      {
        data: {
          campaigns: [{ current: { sent: 5 } }],
          total: { current: { sent: 6 } },
          totalBasis: { covers: "campaigns", description: "active" },
        },
      },
      6
    ),
  ],
  "15 empty filtered list": [
    judgeEmptyFiltered([
      {
        complete: true,
        empty: true,
        notes: ["No campaign has status paused."],
        status: "paused",
      },
    ]),
    judgeEmptyFiltered([
      { complete: true, empty: true, notes: [], status: "paused" },
    ]),
  ],
  "16 next hints": [
    judgeNextHints(
      [{ next: "Use thread_context next." }],
      new Set(["thread_context"])
    ),
    judgeNextHints(
      [{ data: { findings: [{ next: "Use step_funnel." }] } }],
      new Set(["thread_context"])
    ),
  ],
  "17 catalog parity": [
    judgeCatalogParity(
      ["hot_leads", "account_summary"],
      new Set(["hot_leads"]),
      "Left out while redact is on: account_summary."
    ),
    judgeCatalogParity(
      ["hot_leads", "step_funnel"],
      new Set(["hot_leads"]),
      ""
    ),
  ],
  "18 progress": [
    judgeProgress(outcome({ firstProgressMs: 5000, ms: 90_000 })),
    judgeProgress(outcome({ firstProgressMs: null, ms: 90_000 })),
  ],
  "19 time budget": [
    judgeTimeBudget(outcome({ complete: false, ms: 60_500 })),
    judgeTimeBudget(outcome({ complete: false, ms: 120_000 })),
  ],
  "20 request budget": [
    judgeRequestCap(outcome({ complete: false })),
    judgeRequestCap(outcome({ code: "RateLimited", isError: true })),
  ],
  "21 person reconcile": [
    judgePersonReconcile(
      { data: { totals: { messagesSent: 1, replies: 1 } } },
      { data: { timeline: [{ direction: "out" }, { direction: "in" }] } }
    ),
    judgePersonReconcile(
      {
        data: { totals: { messagesSent: 4, replies: 1 } },
        meta: { notes: [] },
      },
      { data: { timeline: [{ direction: "out" }] }, meta: { notes: [] } }
    ),
  ],
  "22 identity": [
    judgeIdentity([{ leadRef: "a" }, { leadRef: "b" }], [], ["email"]),
    judgeIdentity([{ leadRef: "a" }], [], []),
  ],
  "23 replied sources": [
    judgeRepliedSources(3, 2, "people"),
    judgeRepliedSources(3, 2, null),
  ],
  "24 redact parity": [
    judgeRedactParity([["t1"], ["t1"]], ["t1"], {
      cli: "redact has no key",
      sdk: ["Set OUTBOUND_REDACT_KEY"],
    }),
    judgeRedactParity([["t1"], ["t2"]], ["t1"], { cli: "", sdk: [] }),
  ],
  "25 incremental sync": [
    judgeSync({ filter: "client", notes: ["a full walk"], requests: 3 }),
    judgeSync({ filter: "client", notes: [], requests: 3 }),
  ],
  "26 CLI truncation": [
    judgeTruncation(3, {}),
    judgeTruncation(0, { meta: {} }),
  ],
  "27 daily stats": [
    judgeDailySums(
      "campaign",
      [{ date: "d", provider: "p", replied: 2, sent: 10 }],
      [
        { date: "d", provider: "p", replied: 1, sent: 4 },
        { date: "d", provider: "p", replied: 1, sent: 6 },
      ]
    ),
    judgeDailySums(
      "campaign",
      [{ date: "d", provider: "p", replied: null, sent: 10 }],
      [{ date: "d", provider: "p", replied: 1, sent: 10 }]
    ),
  ],
  "28 missing days": [
    judgeMissingDays(
      [{ provider: "p", timezone: "UTC" }],
      2,
      ["p"],
      ["A day with no activity is not reported."]
    ),
    judgeMissingDays([{ provider: "p", timezone: null }], 1, ["p"], []),
  ],
  "29 meetings": [
    judgeMeetings(
      [{ current: { meetingsBooked: null }, provider: "heyreach" }],
      ["heyreach"]
    ),
    judgeMeetings(
      [{ current: { meetingsBooked: 0 }, provider: "heyreach" }],
      ["heyreach"]
    ),
  ],
  "30 variant_test": [
    judgeVariantTest([
      {
        data: { finding: "No step has two variants.", steps: [] },
        meta: { notes: [] },
      },
    ]),
    judgeVariantTest([{ data: { steps: [] }, meta: { notes: [] } }]),
  ],
  "31 provenance": [
    judgeProvenance(
      [{ campaign: "x", provider: "instantly" }],
      [{ provider: "instantly", ref: "instantly:w:1", workspaceId: "w" }]
    ),
    judgeProvenance(
      [{ campaign: "x" }],
      [{ provider: "instantly", ref: "1", workspaceId: "w" }]
    ),
  ],
  "32 surface size": [
    judgeSurfaceSize(LIST_BUDGET_BYTES - 1, [
      outcome({ contentBytes: 50, structuredBytes: 1000 }),
    ]),
    judgeSurfaceSize(LIST_BUDGET_BYTES + 1, [
      outcome({ contentBytes: 1000, structuredBytes: 1000 }),
    ]),
  ],
});

test("a next hint names the tool it points to, not the input it mentions", () => {
  assert.deepEqual(
    hintedTools(
      "Use thread_context with the lead refs, or hot_leads. Raise max_replies."
    ),
    ["thread_context", "hot_leads"]
  );
});

test("a follow-up rule with nothing marked needed is a skip, not a pass", () => {
  assert.equal(judgeFollowUpRule([auto]).status, "skip");
});

test("a request cap that the call never reached is a skip", () => {
  assert.equal(judgeRequestCap(outcome({ complete: true })).status, "skip");
});
