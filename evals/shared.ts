// Inputs several cases share, read once per run through the session's memo.

import type { Context } from "./context.ts";
import { at, list, num, text } from "./json.ts";
import type { CallOutcome } from "./session.ts";

/** Every reply category dropped_replies takes, so a hand-off case has conversations to follow. */
export const WIDE_DROPPED = {
  categories: ["positive", "neutral", "unknown", "negative", "ooo"],
  include_auto: true,
  older_than_hours: 0,
} as const;

export const itemsOf = (
  outcome: CallOutcome,
  ...path: readonly string[]
): readonly unknown[] => list(at(outcome.structured, "data", ...path));

/** dropped_replies with its defaults, and the wide call when the defaults list nothing. */
export const droppedItems = async (
  ctx: Context
): Promise<{
  readonly outcome: CallOutcome;
  readonly items: readonly unknown[];
}> => {
  const mcp = ctx.mcp();
  const defaults = await mcp.call("unanswered_replies");
  const items = itemsOf(defaults, "dropped");

  if (items.length > 0) {
    return { items, outcome: defaults };
  }

  const wide = await mcp.call("unanswered_replies", { ...WIDE_DROPPED });

  return { items: itemsOf(wide, "dropped"), outcome: wide };
};

/**
 * One check of a merged tool such as `list_hygiene`, with that check's
 * answer under `data`, as the tool it runs gives it.
 */
export const callCheck = async (
  ctx: Context,
  tool: string,
  check: string,
  args: Readonly<Record<string, number | string>> = {}
): Promise<CallOutcome> => {
  const outcome = await ctx.mcp().call(tool, { ...args, checks: [check] });
  const data = at(outcome.structured, "data", check);

  return outcome.isError || data === undefined
    ? outcome
    : {
        ...outcome,
        structured: {
          ...(outcome.structured as Record<string, unknown>),
          data,
        },
      };
};

/** Active campaign refs, largest by messages sent first. */
export const activeCampaigns = async (
  ctx: Context
): Promise<readonly string[]> => {
  const overview = await ctx.mcp().call("campaigns", { limit: 50 });

  return itemsOf(overview, "campaigns")
    .map((row) => ({
      ref: text(at(row, "campaign")),
      sent: num(at(row, "metrics", "sent")) ?? 0,
    }))
    .filter((row): row is { ref: string; sent: number } => row.ref !== null)
    .toSorted((left, right) => right.sent - left.sent)
    .map((row) => row.ref);
};

/** The YYYY-MM-DD of `days` before the context's now. */
export const dayBefore = (ctx: Context, days: number): string =>
  new Date(ctx.now() - days * 86_400_000).toISOString().slice(0, 10);

export const codeOf = (outcome: CallOutcome): string =>
  outcome.code ?? "an error";

export const unique = <Value>(values: readonly Value[]): Value[] => [
  ...new Set(values),
];

const IRREGULAR: Readonly<Record<string, string>> = {
  person: "people",
  reply: "replies",
  "positive reply": "positive replies",
};

export const plural = (count: number, word: string): string =>
  `${count} ${count === 1 ? word : (IRREGULAR[word] ?? `${word}s`)}`;
