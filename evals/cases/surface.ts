// The MCP surface: cases 6, 16-20, 31 and 32.

import type { Case, Verdict } from "../case.ts";
import { fail, firstFailure, pass, skip } from "../case.ts";
import type { Context } from "../context.ts";
import { DEFAULT_FLAGS } from "../context.ts";
import { at, isRecord, list, text } from "../json.ts";
import type { CallOutcome } from "../session.ts";
import { activeCampaigns, codeOf, itemsOf, plural, unique } from "../shared.ts";

/** Case 6: no tool's defaults are Unsupported under the default flags. */
export const judgeDefaults = (outcomes: readonly CallOutcome[]): Verdict => {
  const unsupported = outcomes.flatMap((outcome) =>
    outcome.code === "Unsupported" ? [outcome.name] : []
  );

  const deadEnds = outcomes.filter(
    (outcome) => outcome.code === "Unsupported" || outcome.code === "Invalid"
  ).length;

  return unsupported.length > 0
    ? fail(`Unsupported at defaults: ${unsupported.join(", ")}`, {
        deadEndsAtDefaults: deadEnds,
      })
    : pass(
        `${plural(outcomes.length, "tool")} called with defaults, none Unsupported`,
        { deadEndsAtDefaults: deadEnds }
      );
};

const HINT =
  /\b(?:[Uu]se|[Cc]all|[Rr]un|[Tt]ry|[Tt]hen|[Oo]r)\s+`?(?<tool>[a-z]+(?:_[a-z]+)+)`?/gu;

/** The tool names a `next` text tells the reader to use. */
export const hintedTools = (next: string): string[] =>
  [...next.matchAll(HINT)].flatMap((match) =>
    match.groups?.tool === undefined ? [] : [match.groups.tool]
  );

const nextTexts = (value: unknown, found: string[] = []): string[] => {
  if (Array.isArray(value)) {
    for (const item of value) {
      nextTexts(item, found);
    }
  } else if (isRecord(value)) {
    for (const [key, item] of Object.entries(value)) {
      if (key === "next" && typeof item === "string") {
        found.push(item);
      } else {
        nextTexts(item, found);
      }
    }
  }

  return found;
};

/** Case 16: every tool a `next` names is in tools/list. */
export const judgeNextHints = (
  structured: readonly unknown[],
  listed: ReadonlySet<string>
): Verdict => {
  const named = unique(
    structured.flatMap((value) => nextTexts(value)).flatMap(hintedTools)
  );

  const missing = named.filter((name) => !listed.has(name));

  return missing.length > 0
    ? fail(
        `next names tools that tools/list does not offer: ${missing.join(", ")}`
      )
    : pass(
        `all ${plural(named.length, "tool")} named in next hints are listed`
      );
};

/** Case 17: every CLI insight is offered over MCP, or the server says why not. */
export const judgeCatalogParity = (
  insights: readonly string[],
  listed: ReadonlySet<string>,
  instructions: string
): Verdict => {
  const missing = insights.filter(
    (name) => !listed.has(name) && !instructions.includes(name)
  );

  return missing.length > 0
    ? fail(
        `CLI insights not offered over MCP and not explained: ${missing.join(", ")}`
      )
    : pass(
        `all ${plural(insights.length, "CLI insight")} are offered over MCP or explained`
      );
};

const PROGRESS_MS = 30_000;

/** Case 18: a long call reports progress within 30 s. */
export const judgeProgress = (outcome: CallOutcome): Verdict => {
  if (outcome.ms < PROGRESS_MS) {
    return pass(
      `${outcome.name} answered in ${Math.round(outcome.ms / 1000)} s, inside the progress window`
    );
  }

  return outcome.firstProgressMs !== null &&
    outcome.firstProgressMs <= PROGRESS_MS
    ? pass(
        `first progress after ${Math.round(outcome.firstProgressMs / 1000)} s of a ${Math.round(outcome.ms / 1000)} s call`
      )
    : fail(
        `no progress within 30 s of a ${Math.round(outcome.ms / 1000)} s call`
      );
};

const BUDGET_S = 60;

/** Case 19: a call under a 60 s budget answers by about 65 s, incomplete when it ran out. */
export const judgeTimeBudget = (outcome: CallOutcome): Verdict => {
  const seconds = outcome.ms / 1000;

  return firstFailure(
    [
      seconds > BUDGET_S + 5
        ? `${outcome.name} took ${Math.round(seconds)} s under a ${BUDGET_S} s budget`
        : null,
      seconds >= BUDGET_S - 5 && outcome.complete !== false
        ? `${outcome.name} used its whole budget but says complete ${String(outcome.complete)}`
        : null,
      outcome.isError
        ? `${outcome.name} answered ${codeOf(outcome)} at its time budget instead of what it read`
        : null,
    ],
    `${outcome.name} answered in ${Math.round(seconds)} s, complete ${String(outcome.complete)}`
  );
};

const CAP = 5;

/** Case 20: a request cap keeps partial work, under a code that is not RateLimited. */
export const judgeRequestCap = (outcome: CallOutcome): Verdict => {
  if (outcome.isError) {
    return outcome.code === "RateLimited"
      ? fail(
          `--max-requests ${CAP} ended ${outcome.name} as RateLimited, like a vendor 429`
        )
      : fail(
          `--max-requests ${CAP} ended ${outcome.name} with ${codeOf(outcome)} and no partial answer`
        );
  }

  if (outcome.complete === true) {
    return skip(`${outcome.name} finished inside ${CAP} requests`);
  }

  return pass(
    `${outcome.name} kept a partial answer (complete false) at --max-requests ${CAP}`
  );
};

const REF_FIELDS = ["campaign", "lead", "reply", "sender"] as const;

/** Case 31: every row carrying a ref also says its provider; every SDK record its workspace and qualified ref. */
export const judgeProvenance = (
  rows: readonly unknown[],
  records: readonly unknown[]
): Verdict => {
  const bareRows = rows.filter(
    (row) =>
      REF_FIELDS.some((field) => typeof at(row, field) === "string") &&
      text(at(row, "provider")) === null
  ).length;

  const bareRecords = records.filter((record) => {
    const provider = text(at(record, "provider"));
    const workspace = text(at(record, "workspaceId"));

    return (
      provider === null ||
      workspace === null ||
      !(text(at(record, "ref")) ?? "").startsWith(`${provider}:${workspace}:`)
    );
  }).length;

  return firstFailure(
    [
      bareRows > 0
        ? `${bareRows} of ${plural(rows.length, "MCP row")} carry a ref but no provider`
        : null,
      bareRecords > 0
        ? `${bareRecords} of ${plural(records.length, "SDK record")} lack provider, workspaceId or a qualified ref`
        : null,
    ],
    `${plural(rows.length, "MCP row")} and ${plural(records.length, "SDK record")} carry their provenance`
  );
};

/** The tools/list budget until OUT-168 agrees a figure. */
export const LIST_BUDGET_BYTES = 40_000;

/** Case 32: tools/list stays small, and a result is not sent twice. */
export const judgeSurfaceSize = (
  listBytes: number,
  outcomes: readonly CallOutcome[]
): Verdict => {
  const twice = outcomes.filter(
    (outcome) =>
      outcome.structuredBytes > 0 &&
      outcome.contentBytes >= outcome.structuredBytes * 0.9
  ).length;

  return firstFailure(
    [
      listBytes > LIST_BUDGET_BYTES
        ? `tools/list is ${listBytes} B, over the ${LIST_BUDGET_BYTES} B budget`
        : null,
      twice > 0
        ? `${twice} of ${plural(outcomes.length, "result")} send the structured answer again as text`
        : null,
    ],
    `tools/list ${listBytes} B; results sent once`,
    { listBytes, toolCount: null }
  );
};

/** A first value for each required input the defaults case cannot leave out. */
const requiredArgs = async (
  ctx: Context,
  required: readonly string[]
): Promise<Record<string, unknown> | undefined> => {
  const args: Record<string, unknown> = {};

  for (const key of required) {
    if (key === "campaign") {
      const [campaign] = await activeCampaigns(ctx);

      if (campaign === undefined) {
        return undefined;
      }

      args[key] = campaign;
    } else {
      return undefined;
    }
  }

  return args;
};

const allStructured = async (ctx: Context): Promise<unknown[]> => {
  const outcomes = await defaultsOutcomes(ctx);

  return outcomes.map((outcome) => outcome.structured);
};

const defaultsCache = new WeakMap<Context, Promise<CallOutcome[]>>();

/** Every listed tool, called with its defaults (and a campaign where one is required). */
const defaultsOutcomes = (ctx: Context): Promise<CallOutcome[]> => {
  const known = defaultsCache.get(ctx);

  if (known !== undefined) {
    return known;
  }

  const pending = (async () => {
    const mcp = ctx.mcp();
    const outcomes: CallOutcome[] = [];

    for (const tool of await mcp.tools()) {
      const args = await requiredArgs(ctx, tool.required);

      if (args !== undefined) {
        outcomes.push(await mcp.call(tool.name, args));
      }
    }

    return outcomes;
  })();

  defaultsCache.set(ctx, pending);

  return pending;
};

export const SURFACE_CASES: readonly Case[] = [
  {
    id: 6,
    issue: "OUT-151",
    p1: true,
    run: async (ctx) => judgeDefaults(await defaultsOutcomes(ctx)),
    title: "defaults under default flags",
  },
  {
    id: 16,
    issue: "OUT-152",
    p1: false,
    run: async (ctx) => {
      const listed = new Set(
        (await ctx.mcp().tools()).map((tool) => tool.name)
      );

      return judgeNextHints(await allStructured(ctx), listed);
    },
    title: "next hints",
  },
  {
    id: 17,
    issue: "OUT-152",
    p1: false,
    run: async (ctx) => {
      const insights = await ctx.cli([
        "insight",
        "--provider",
        "all",
        "--compact",
      ]);

      const names = list(at(insights.json, "data", "items")).flatMap((item) => {
        const name = text(at(item, "name"));

        return name === null ? [] : [name];
      });

      if (names.length === 0) {
        return fail(
          `outbound insight listed no insights (exit ${insights.code})`
        );
      }

      const listed = new Set(
        (await ctx.mcp().tools()).map((tool) => tool.name)
      );

      const instructions =
        text(at(await ctx.mcp().initialize(), "instructions")) ?? "";

      return judgeCatalogParity(names, listed, instructions);
    },
    title: "catalog parity",
  },
  {
    id: 18,
    issue: "OUT-154",
    p1: false,
    run: async (ctx) =>
      judgeProgress(await ctx.mcp().call("hot_leads", {}, { progress: true })),
    title: "progress",
  },
  {
    id: 19,
    issue: "OUT-154",
    p1: false,
    run: async (ctx) =>
      judgeTimeBudget(
        await ctx
          .mcp([...DEFAULT_FLAGS, "--time-budget", String(BUDGET_S)])
          .call("hot_leads", { max_leads: 20_000, max_replies: 20_000 })
      ),
    title: "time budget",
  },
  {
    id: 20,
    issue: "OUT-156",
    p1: false,
    run: async (ctx) =>
      judgeRequestCap(
        await ctx
          .mcp([...DEFAULT_FLAGS, "--max-requests", String(CAP)])
          .call("client_report")
      ),
    title: "request budget",
  },
  {
    id: 31,
    issue: "OUT-166",
    p1: false,
    run: async (ctx) => {
      const mcp = ctx.mcp();

      const rows = [
        ...itemsOf(
          await mcp.call("campaign_overview", { limit: 50 }),
          "campaigns"
        ),
        ...itemsOf(await mcp.call("reply_samples"), "replies"),
        ...itemsOf(await mcp.call("period_comparison"), "campaigns"),
      ];

      const outbound = await ctx.sdk();
      const records: unknown[] = [];

      const reads: (() => Promise<{
        readonly items: readonly unknown[];
        readonly meta: { readonly requests: number };
      }>)[] = [
        () => outbound.campaigns.list({ limit: 5 }),
        () => outbound.senders.list({ limit: 5 }),
        () => outbound.replies.list({ limit: 5 }),
      ];

      for (const read of reads) {
        ctx.budget.check();
        const page = await ctx.settle(read());
        ctx.budget.spend(page.meta.requests);
        records.push(...page.items);
      }

      return judgeProvenance(rows, records);
    },
    title: "provenance",
  },
  {
    id: 32,
    issue: "OUT-168",
    p1: false,
    run: async (ctx) => {
      const mcp = ctx.mcp();

      const verdict = judgeSurfaceSize(
        await mcp.listBytes(),
        await defaultsOutcomes(ctx)
      );

      return {
        ...verdict,
        truth: { ...verdict.truth, toolCount: (await mcp.tools()).length },
      };
    },
    title: "surface size",
  },
];
