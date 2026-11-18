// People and redaction: cases 21-24.

import { randomBytes } from "node:crypto";

import { createOutbound } from "../../packages/outbound-sdk/src/index.ts";
import { redact } from "../../packages/outbound-sdk/src/redact/index.ts";
import type { Case, Verdict } from "../case.ts";
import { fail, firstFailure, pass, skip } from "../case.ts";
import type { Context } from "../context.ts";
import { DEFAULT_FLAGS } from "../context.ts";
import { at, list, num, text } from "../json.ts";
import {
  activeCampaigns,
  dayBefore,
  itemsOf,
  plural,
  unique,
} from "../shared.ts";

/** Person tools need real identifiers, so these cases read without redact. Nothing they read is written. */
const UNMASKED = [...DEFAULT_FLAGS, "--no-redact"] as const;

const EXPLAINED = /exclud|automatic|not counted|own campaign|once|only/iu;

const notesOf = (structured: unknown): string[] =>
  list(at(structured, "meta", "notes")).map(String);

/** Case 21: person_summary and cross_channel_lead agree, or say what each leaves out. */
export const judgePersonReconcile = (
  summary: unknown,
  timeline: unknown
): Verdict => {
  const sent = num(at(summary, "data", "totals", "messagesSent"));
  const replies = num(at(summary, "data", "totals", "replies"));
  const messages = list(at(timeline, "data", "timeline"));

  const out = messages.filter(
    (message) => at(message, "direction") === "out"
  ).length;

  const inbound = messages.filter(
    (message) => at(message, "direction") === "in"
  ).length;

  if (sent === out && replies === inbound) {
    return pass(
      `person_summary and cross_channel_lead agree: ${out} sent, ${inbound} replies`
    );
  }

  const explained = [...notesOf(summary), ...notesOf(timeline)].some((note) =>
    EXPLAINED.test(note)
  );

  return explained
    ? pass(
        `counts differ (sent ${String(sent)} vs ${out}, replies ${String(replies)} vs ${inbound}) and a note says what is left out`
      )
    : fail(
        `counts differ (sent ${String(sent)} vs ${out}, replies ${String(replies)} vs ${inbound}) and neither answer says what it leaves out`
      );
};

/** Identifier types every tool holding the person can be searched by. */
export const sharedIdentifiers = (timeline: unknown): string[] => {
  const links = list(at(timeline, "data", "links"));
  const sets = links.map((link) => list(at(link, "searchable")).map(String));
  const [first = [], ...rest] = sets;

  return first.filter((kind) => rest.every((set) => set.includes(kind)));
};

/** Whether one person's records were actually found in two or more tools: a link observed, not declared. */
export const linkObserved = (timeline: unknown): boolean =>
  new Set(
    list(at(timeline, "data", "records")).map((record) =>
      text(at(record, "provider"))
    )
  ).size > 1;

/**
 * Case 22: people never outnumber lead refs, and "can't link" is said, not
 * shown as 0 overlap. Its truth says people can be linked only when a link
 * was observed; a shared searchable type alone leaves it unknown.
 */
export const judgeIdentity = (
  rows: readonly unknown[],
  notes: readonly string[],
  shared: readonly string[] | null,
  observed = false
): Verdict => {
  // A row with no lead ref (a reply outside every campaign) names nobody to count.
  const named = rows.filter((row) => typeof at(row, "leadRef") === "string");
  const refs = unique(named.map((row) => String(at(row, "leadRef"))));

  const linked = shared === null ? null : shared.length > 0;
  let canLink: boolean | null = null;

  if (linked === false) {
    canLink = false;
  } else if (observed) {
    canLink = true;
  }

  return firstFailure(
    [
      named.length > refs.length
        ? `${named.length} people from only ${plural(refs.length, "lead ref")}`
        : null,
      linked === false && !notes.some((note) => /link|identifier/iu.test(note))
        ? "the tools share no identifier type, but the per-person answer does not say it cannot link them"
        : null,
    ],
    `${plural(rows.length, "person")} from ${plural(refs.length, "lead ref")}; can link ${String(canLink)}`,
    { canLink, peopleReplied: rows.length }
  );
};

/** Case 23: when lead.replied and reply messages disagree, the totals say which they count. */
export const judgeRepliedSources = (
  leadsReplied: number,
  peopleWithReplies: number,
  basis: string | null
): Verdict => {
  if (leadsReplied === peopleWithReplies) {
    return pass(`lead.replied and reply messages agree: ${leadsReplied}`);
  }

  return basis === null
    ? fail(
        `lead.replied counts ${leadsReplied} and reply messages ${peopleWithReplies}, and the totals do not say which they count`
      )
    : pass(
        `lead.replied counts ${leadsReplied} and reply messages ${peopleWithReplies}; the totals count ${basis}`
      );
};

const warns = (said: string): boolean =>
  /no key|OUTBOUND_REDACT_KEY/u.test(said);

/** Case 24: one key gives one token per address, across runs and surfaces, and no key warns. */
export const judgeRedactParity = (
  sdkRuns: readonly (readonly string[])[],
  cli: readonly string[],
  keyless: { readonly sdk: readonly string[]; readonly cli: string }
): Verdict => {
  const [first = [], second = []] = sdkRuns;
  const across = first.filter((token, index) => second[index] !== token).length;

  const surfaces = first.filter(
    (token, index) => cli[index] !== undefined && cli[index] !== token
  ).length;

  return firstFailure(
    [
      first.length === 0 ? "no redacted address to compare" : null,
      across > 0
        ? `${across} of ${plural(first.length, "token")} changed between two SDK runs with the same key`
        : null,
      surfaces > 0
        ? `${surfaces} of ${plural(first.length, "token")} differ between the CLI and the SDK with the same key`
        : null,
      keyless.sdk.some(warns)
        ? null
        : "the SDK redacts a list read with no key and gives no warning",
      warns(keyless.cli)
        ? null
        : "the CLI redacts with no key and gives no warning",
    ],
    `${plural(first.length, "token")} equal across runs and surfaces; no key warns`
  );
};

const firstRepliedLead = async (ctx: Context): Promise<string | undefined> => {
  const samples = await ctx.mcp(UNMASKED).call("reply_samples");

  return itemsOf(samples, "replies")
    .map((reply) => text(at(reply, "lead")))
    .find((lead): lead is string => lead !== null);
};

const timelineOf = async (ctx: Context) => {
  const lead = await firstRepliedLead(ctx);

  return lead === undefined
    ? undefined
    : {
        lead,
        timeline: await ctx
          .mcp(UNMASKED)
          .call("cross_channel_lead", { lead_ref: lead }),
      };
};

const tokensOf = (items: readonly unknown[]): string[] =>
  items.map((item) => text(at(item, "leadEmail")) ?? "");

export const PEOPLE_CASES: readonly Case[] = [
  {
    id: 21,
    issue: "OUT-157",
    p1: false,
    run: async (ctx) => {
      const found = await timelineOf(ctx);

      if (found === undefined) {
        return skip("reply_samples listed no reply with a lead");
      }

      const summary = await ctx
        .mcp(UNMASKED)
        .call("person_summary", { lead_ref: found.lead });

      if (summary.isError || found.timeline.isError) {
        return fail(
          `person_summary answered ${summary.code ?? "ok"} and cross_channel_lead ${found.timeline.code ?? "ok"}`
        );
      }

      return judgePersonReconcile(
        summary.structured,
        found.timeline.structured
      );
    },
    title: "person reconcile",
  },
  {
    id: 22,
    issue: "OUT-159",
    p1: false,
    run: async (ctx) => {
      const byPerson = await ctx.cli([
        "replies",
        "--by",
        "person",
        "--since",
        dayBefore(ctx, 30),
        "--provider",
        "all",
        "--no-redact",
        "--compact",
      ]);

      if (byPerson.code !== 0) {
        return fail(`replies --by person exited ${byPerson.code}`);
      }

      const found = await timelineOf(ctx);

      const shared =
        found === undefined || found.timeline.isError
          ? null
          : sharedIdentifiers(found.timeline.structured);

      return judgeIdentity(
        list(at(byPerson.json, "data", "items")),
        list(at(byPerson.json, "meta", "notes")).map(String),
        shared,
        found !== undefined &&
          !found.timeline.isError &&
          linkObserved(found.timeline.structured)
      );
    },
    title: "identity",
  },
  {
    id: 23,
    issue: "OUT-158",
    p1: false,
    run: async (ctx) => {
      const [campaign] = await activeCampaigns(ctx);

      if (campaign === undefined) {
        return skip("no active campaign");
      }

      const outbound = await ctx.sdk();
      ctx.budget.check();

      const leads = await ctx.settle(
        outbound.campaign(campaign).leads.list({ limit: 100 })
      );

      ctx.budget.spend(leads.meta.requests);

      const replies = await ctx.settle(
        outbound.campaign(campaign).replies.list({ limit: 100 })
      );

      ctx.budget.spend(replies.meta.requests);

      const replied = new Set(
        leads.items
          .filter((lead) => lead.replied === true)
          .map((lead) => lead.ref)
      );

      const read = new Set(leads.items.map((lead) => lead.ref));

      const withReplies = unique(
        replies.items.flatMap((reply) =>
          reply.leadRef !== null &&
          reply.leadRef !== undefined &&
          read.has(reply.leadRef)
            ? [reply.leadRef]
            : []
        )
      );

      const period = await ctx.mcp().call("period_comparison");

      return judgeRepliedSources(
        replied.size,
        withReplies.length,
        text(at(period.structured, "data", "totalBasis", "replies"))
      );
    },
    title: "replied sources",
  },
  {
    id: 24,
    issue: "OUT-150",
    p1: true,
    run: async (ctx) => {
      // A throwaway key for this run only; it is never written anywhere.
      const key = randomBytes(24).toString("hex");
      const options = await ctx.sdkOptions();
      const runs: string[][] = [];
      let refs: string[] = [];

      for (let index = 0; index < 2; index += 1) {
        ctx.budget.check();

        const page = await ctx.settle(
          createOutbound({
            ...options,
            plugins: [redact({ key })],
          }).replies.list({ limit: 5 })
        );

        ctx.budget.spend(page.meta.requests);
        runs.push(tokensOf(page.items));
        refs = page.items.map((item) => item.ref);
      }

      const cli = await ctx.cli(
        [
          "replies",
          "--limit",
          "5",
          "--provider",
          "all",
          "--redact",
          "--compact",
        ],
        { OUTBOUND_REDACT_KEY: key }
      );

      const cliItems = list(at(cli.json, "data", "items"));

      const cliTokens = refs.map(
        (ref) =>
          text(
            at(
              cliItems.find((item) => at(item, "ref") === ref),
              "leadEmail"
            )
          ) ?? ""
      );

      ctx.budget.check();

      const keyless = await ctx.settle(
        createOutbound({ ...options, plugins: [redact()] }).replies.list({
          limit: 1,
        })
      );

      ctx.budget.spend(keyless.meta.requests);

      const keylessCli = await ctx.cli([
        "replies",
        "--limit",
        "1",
        "--provider",
        "all",
        "--redact",
        "--compact",
      ]);

      const cliSaid = `${keylessCli.stderr}\n${list(
        at(keylessCli.json, "meta", "notes")
      )
        .map(String)
        .join("\n")}`;

      return cli.code === 0 || cli.code === 3
        ? judgeRedactParity(runs, cliTokens, {
            cli: cliSaid,
            sdk: keyless.meta.notes,
          })
        : fail(`replies --redact exited ${cli.code}`);
    },
    title: "redact parity",
  },
];
