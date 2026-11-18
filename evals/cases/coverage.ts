// Caps, coverage and totals: cases 11-15.

import type { Case, Verdict } from "../case.ts";
import { fail, firstFailure, pass, skip } from "../case.ts";
import type { Context } from "../context.ts";
import { at, bool, list, num, text } from "../json.ts";
import { codeOf, dayBefore, itemsOf, plural } from "../shared.ts";

/** A finding that says what it did not check. */
const QUALIFIED =
  /not checked|unchecked|could not|cannot|incomplete|partial|only|stopped|at least|none found in/iu;

export interface CappedRun {
  readonly found: number | null;
  readonly complete: boolean | null;
  readonly finding: string | null;
}

/** Cases 11 and 12: an incomplete zero is never "none", and raising caps never finds fewer. */
export const judgeCapped = (
  label: string,
  defaults: CappedRun,
  raised: CappedRun
): Verdict => {
  const truth = {
    completeDefault: defaults.complete,
    completeRaised: raised.complete,
    foundDefault: defaults.found,
    foundRaised: raised.found,
  };

  return firstFailure(
    [
      defaults.found === null || raised.found === null
        ? `${label} gave no count`
        : null,
      defaults.complete === false &&
      defaults.found === 0 &&
      !QUALIFIED.test(defaults.finding ?? "")
        ? `${label} reports 0 at default caps with meta.complete false and a finding that does not say what went unchecked`
        : null,
      raised.complete === false &&
      raised.found === 0 &&
      !QUALIFIED.test(raised.finding ?? "")
        ? `${label} reports 0 at raised caps with meta.complete false and a finding that does not say what went unchecked`
        : null,
      (raised.found ?? 0) < (defaults.found ?? 0)
        ? `${label} found ${raised.found} with raised caps, fewer than ${defaults.found} at defaults`
        : null,
    ],
    `${label}: ${defaults.found} at defaults (complete ${String(defaults.complete)}), ${raised.found} raised (complete ${String(raised.complete)})`,
    truth
  );
};

/** Case 13: a provider with activity is read, or named as left out. */
export const judgeProvidersLeftOut = (
  active: readonly string[],
  read: readonly string[],
  leftOut: string
): Verdict => {
  const missing = active.filter(
    (provider) => !read.includes(provider) && !leftOut.includes(provider)
  );

  return missing.length > 0
    ? fail(
        `${missing.join(", ")} sent in the window but is neither counted nor named as left out`
      )
    : pass(
        `every provider that sent in the window (${active.join(", ") || "none"}) is counted or named`
      );
};

/** Case 14: the headline total adds up from its rows, and says what it covers. */
export const judgeHeadline = (
  structured: unknown,
  workspaceSent: number | null
): Verdict => {
  const total = num(at(structured, "data", "total", "current", "sent"));

  // Campaigns with too few sends to compare are left out of the rows but counted in the total.
  const rows = [
    ...list(at(structured, "data", "campaigns")).map((row) =>
      num(at(row, "current", "sent"))
    ),
    ...list(at(structured, "data", "tooFewSends")).map((row) =>
      num(at(row, "currentSent"))
    ),
  ];

  const summed = rows.every((sent) => sent !== null)
    ? rows.reduce<number>((sum, sent) => sum + (sent ?? 0), 0)
    : null;

  const covers = text(at(structured, "data", "totalBasis", "covers"));
  const description = text(at(structured, "data", "totalBasis", "description"));

  return firstFailure(
    [
      total === null ? "period_comparison gave no total sent" : null,
      summed !== null && total !== null && summed !== total
        ? `the total sent (${total}) is not the sum of its ${rows.length} campaign rows (${summed})`
        : null,
      workspaceSent !== null &&
      total !== null &&
      workspaceSent !== total &&
      (covers === null || covers === "workspace" || description === null)
        ? `the total sent (${total}) differs from the workspace stats (${workspaceSent}) and does not say what it covers`
        : null,
    ],
    `total sent ${total} = sum of ${plural(rows.length, "campaign row")}; covers ${covers ?? "?"}`
  );
};

/** Case 15: an empty, complete list names the filter that emptied it. */
export const judgeEmptyFiltered = (
  answers: readonly {
    readonly status: string;
    readonly empty: boolean;
    readonly complete: boolean | null;
    readonly notes: readonly string[];
  }[]
): Verdict => {
  const silent = answers.filter(
    (answer) =>
      answer.empty &&
      answer.complete === true &&
      !answer.notes.some((note) => /status|filter/iu.test(note))
  );

  const empties = answers.filter((answer) => answer.empty).length;

  return silent.length > 0
    ? fail(
        `campaign_overview with status ${silent.map((answer) => answer.status).join(", ")} is empty and complete with no note naming the filter`
      )
    : pass(
        `${plural(empties, "empty filtered list")} of ${answers.length}, each naming its filter`
      );
};

const cappedRun = (structured: unknown, count: string): CappedRun => ({
  complete: bool(at(structured, "meta", "complete")),
  finding: text(at(structured, "data", "finding")),
  // A capped run leaves the definite count null and gives what it found so far.
  found:
    num(at(structured, "data", "totals", `${count}Found`)) ??
    num(at(structured, "data", "totals", count)),
});

const capped = async (
  ctx: Context,
  tool: string,
  count: string,
  raised: Record<string, number>
): Promise<Verdict> => {
  const mcp = ctx.mcp();
  const defaults = await mcp.call(tool);

  if (defaults.isError) {
    return fail(`${tool} answered ${codeOf(defaults)}`);
  }

  const more = await mcp.call(tool, raised);

  if (more.isError) {
    return fail(`${tool} with raised caps answered ${codeOf(more)}`);
  }

  return judgeCapped(
    tool,
    cappedRun(defaults.structured, count),
    cappedRun(more.structured, count)
  );
};

/** Providers whose workspace stats show sends in the current period_comparison window. */
const activeProviders = async (
  ctx: Context,
  from: string,
  to: string
): Promise<{ readonly providers: string[]; readonly sent: number | null }> => {
  const stats = await ctx.cli([
    "stats",
    "--scope",
    "workspace",
    "--by",
    "total",
    "--from",
    from,
    "--to",
    to,
    "--provider",
    "all",
    "--compact",
  ]);

  const rows = list(at(stats.json, "data", "rows"));
  const sending = rows.filter((row) => (num(at(row, "sent")) ?? 0) > 0);

  const sent = rows.every((row) => num(at(row, "sent")) !== null)
    ? rows.reduce<number>((sum, row) => sum + (num(at(row, "sent")) ?? 0), 0)
    : null;

  return {
    providers: [
      ...new Set(sending.map((row) => text(at(row, "provider")) ?? "?")),
    ],
    sent: rows.length === 0 ? null : sent,
  };
};

const STATUSES = ["paused", "completed", "draft", "archived"] as const;

export const COVERAGE_CASES: readonly Case[] = [
  {
    id: 11,
    issue: "OUT-148",
    p1: true,
    run: (ctx) =>
      capped(ctx, "suppression_check", "violations", {
        max_block_entries: 20_000,
        max_leads_per_campaign: 2000,
      }),
    title: "suppression, defaults vs raised caps",
  },
  {
    id: 12,
    issue: "OUT-148",
    p1: true,
    run: (ctx) =>
      capped(ctx, "lead_collisions", "collisions", {
        max_leads_per_campaign: 2000,
      }),
    title: "lead_collisions, defaults vs raised caps",
  },
  {
    id: 13,
    issue: "OUT-155",
    p1: false,
    run: async (ctx) => {
      const period = await ctx.mcp().call("period_comparison");

      if (period.isError) {
        return fail(`period_comparison answered ${codeOf(period)}`);
      }

      const from =
        text(at(period.structured, "data", "current", "from")) ??
        dayBefore(ctx, 7);

      const to =
        text(at(period.structured, "data", "current", "to")) ??
        dayBefore(ctx, 1);

      const { providers } = await activeProviders(ctx, from, to);

      const read = itemsOf(period, "campaigns").map(
        (row) => text(at(row, "provider")) ?? ""
      );

      return judgeProvidersLeftOut(
        providers,
        read,
        JSON.stringify(at(period.structured, "data", "toolsLeftOut") ?? [])
      );
    },
    title: "providers left out",
  },
  {
    id: 14,
    issue: "OUT-158",
    p1: false,
    run: async (ctx) => {
      const period = await ctx.mcp().call("period_comparison");

      if (period.isError) {
        return fail(`period_comparison answered ${codeOf(period)}`);
      }

      const from =
        text(at(period.structured, "data", "current", "from")) ??
        dayBefore(ctx, 7);

      const to =
        text(at(period.structured, "data", "current", "to")) ??
        dayBefore(ctx, 1);

      const { sent } = await activeProviders(ctx, from, to);
      const verdict = judgeHeadline(period.structured, sent);
      const current = at(period.structured, "data", "total", "current");
      const previous = at(period.structured, "data", "total", "previous");

      return {
        ...verdict,
        truth: {
          meetingsCurrent: num(at(current, "meetingsBooked")),
          meetingsPrevious: num(at(previous, "meetingsBooked")),
          repliedCurrent: num(at(current, "replied")),
          repliedPrevious: num(at(previous, "replied")),
          repliesBasis: text(
            at(period.structured, "data", "totalBasis", "replies")
          ),
        },
      };
    },
    title: "headline totals",
  },
  {
    id: 15,
    issue: "OUT-155",
    p1: false,
    run: async (ctx) => {
      const answers = [];

      for (const status of STATUSES) {
        const outcome = await ctx.mcp().call("campaign_overview", { status });

        if (!outcome.isError) {
          answers.push({
            complete: outcome.complete,
            empty: itemsOf(outcome, "campaigns").length === 0,
            notes: list(at(outcome.structured, "meta", "notes")).map(String),
            status,
          });
        }
      }

      return answers.length === 0
        ? skip("campaign_overview took none of the statuses")
        : judgeEmptyFiltered(answers);
    },
    title: "empty filtered list",
  },
];
