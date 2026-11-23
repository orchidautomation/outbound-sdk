// Data paths: cases 25-30.

import { createOutbound } from "../../packages/outbound-sdk/src/index.ts";
import {
  memoryCheckpointStore,
  sync,
} from "../../packages/outbound-sdk/src/sync/index.ts";
import type { SyncResult } from "../../packages/outbound-sdk/src/sync/index.ts";
import type { Case, Verdict } from "../case.ts";
import { fail, firstFailure, pass, skip } from "../case.ts";
import type { Context } from "../context.ts";
import { at, bool, isRecord, list, num, text } from "../json.ts";
import {
  activeCampaigns,
  callCheck,
  codeOf,
  dayBefore,
  plural,
} from "../shared.ts";

/** Case 25: an incremental sync says who filtered and what it cost. */
export const judgeSync = (
  result: Pick<SyncResult, "filter" | "requests" | "notes">
): Verdict =>
  firstFailure(
    [
      ["client", "none", "server"].includes(result.filter)
        ? null
        : `sync gave filter ${String(result.filter)}`,
      typeof result.requests === "number" ? null : "sync gave no request count",
      result.filter === "client" && result.notes.length === 0
        ? "a client-filtered sync carries no note about the full walk it cost"
        : null,
    ],
    `incremental sync: filter ${result.filter}, ${plural(result.requests, "request")}`
  );

/** Case 26: a shell can tell a cut-off listing from a whole one. */
export const judgeTruncation = (code: number, json: unknown): Verdict => {
  if (
    code === 3 ||
    (code === 0 && bool(at(json, "meta", "truncated")) === true)
  ) {
    return pass(`leads --limit 1 exits ${code}`);
  }

  return code === 0
    ? fail(
        "leads --limit 1 stopped with more leads and exits 0 with no truncated field"
      )
    : fail(`leads --limit 1 exited ${code}, so truncation was not exercised`);
};

export interface DayRow {
  readonly provider: string;
  readonly date: string;
  readonly sent: number | null;
  readonly replied: number | null;
}

/** Case 27: summed per day, the parts equal the workspace row, and unreported stays null. */
export const judgeDailySums = (
  label: string,
  workspace: readonly DayRow[],
  parts: readonly DayRow[]
): Verdict => {
  if (workspace.length === 0) {
    return skip("no workspace day rows to compare");
  }

  let mismatches = 0;
  let compared = 0;

  for (const day of workspace) {
    const same = parts.filter(
      (part) => part.provider === day.provider && part.date === day.date
    );

    for (const metric of ["sent", "replied"] as const) {
      const values = same.map((part) => part[metric]);
      const whole = day[metric];

      if (
        whole === null &&
        values.some((value) => value !== null && value > 0)
      ) {
        mismatches += 1;
      } else if (
        whole !== null &&
        values.length > 0 &&
        values.every((value) => value !== null)
      ) {
        compared += 1;
        mismatches +=
          values.reduce<number>((sum, value) => sum + (value ?? 0), 0) === whole
            ? 0
            : 1;
      }
    }
  }

  return mismatches > 0
    ? fail(
        `${mismatches} provider-day counts where ${label} rows do not add up to the workspace row`
      )
    : pass(
        `${plural(compared, "provider-day count")} where ${label} rows add up to the workspace row`
      );
};

/** Case 28: missing days are explained, and every row names its timezone. */
export const judgeMissingDays = (
  rows: readonly unknown[],
  days: number,
  providers: readonly string[],
  notes: readonly string[]
): Verdict => {
  const noZone = rows.filter(
    (row) => text(at(row, "timezone")) === null
  ).length;

  const short = providers.filter(
    (provider) =>
      rows.filter((row) => at(row, "provider") === provider).length < days
  );

  const explained = notes.some((note) =>
    /missing|not reported|no row|zero/iu.test(note)
  );

  return firstFailure(
    [
      noZone > 0
        ? `${noZone} of ${plural(rows.length, "day row")} name no timezone`
        : null,
      short.length > 0 && !explained
        ? `${short.join(", ")} return fewer than ${days} day rows and nothing says whether a missing day is 0 or unreported`
        : null,
    ],
    `${plural(rows.length, "day row")}, each with a timezone; missing days explained`
  );
};

/** Case 29: a provider that records no meetings gives null, never 0. */
export const judgeMeetings = (
  rows: readonly unknown[],
  withoutMeetings: readonly string[]
): Verdict => {
  const zeros = rows.filter(
    (row) =>
      withoutMeetings.includes(text(at(row, "provider")) ?? "") &&
      at(row, "current", "meetingsBooked") !== null
  ).length;

  return zeros > 0
    ? fail(
        `${zeros} campaign rows from a provider that records no meetings give a meetings count`
      )
    : pass(
        `providers without meetings (${withoutMeetings.join(", ") || "none"}) give null`
      );
};

/** Case 30: a campaign with nothing to test says so in a finding. */
export const judgeVariantTest = (answers: readonly unknown[]): Verdict => {
  const silent = answers.filter(
    (answer) =>
      list(at(answer, "data", "steps")).length === 0 &&
      text(at(answer, "data", "finding")) === null &&
      list(at(answer, "meta", "notes")).length === 0
  ).length;

  return silent > 0
    ? fail(
        `variant_test gave ${silent} of ${plural(answers.length, "campaign")} empty steps with no finding or note`
      )
    : pass(
        `variant_test explained every one of ${plural(answers.length, "campaign")}`
      );
};

/** Whether a provider's field coverage says it has no meetings count anywhere. */
const recordsNoMeetings = (fields: unknown): boolean => {
  if (Array.isArray(fields)) {
    return fields.some(recordsNoMeetings);
  }

  if (!isRecord(fields)) {
    return false;
  }

  return Object.entries(fields).some(
    ([key, value]) =>
      (key === "meetingsBooked" && value === false) || recordsNoMeetings(value)
  );
};

const WEEK = 7;

const dayRows = (json: unknown): DayRow[] =>
  list(at(json, "data", "rows")).map((row) => ({
    date: text(at(row, "date")) ?? "",
    provider: text(at(row, "provider")) ?? "",
    replied: num(at(row, "replied")),
    sent: num(at(row, "sent")),
  }));

/** Past this many campaigns the per-campaign half costs one read each and is skipped. */
const MAX_CAMPAIGNS = 60;

const campaignDays = async (
  ctx: Context,
  from: string,
  to: string
): Promise<DayRow[] | string> => {
  const listed = await ctx.cli([
    "campaigns",
    "--limit",
    String(MAX_CAMPAIGNS),
    "--provider",
    "all",
    "--compact",
  ]);

  if (listed.code === 3) {
    return `more than ${MAX_CAMPAIGNS} campaigns, so their day rows cannot be summed in one run`;
  }

  if (listed.code !== 0) {
    return `campaigns exited ${listed.code}`;
  }

  const rows: DayRow[] = [];

  for (const campaign of list(at(listed.json, "data", "items"))) {
    const ref = text(at(campaign, "ref"));

    if (ref !== null) {
      const stats = await ctx.cli([
        "campaign",
        ref,
        "--stats",
        "--by",
        "day",
        "--from",
        from,
        "--to",
        to,
        "--provider",
        "all",
        "--compact",
      ]);

      const stat = at(stats.json, "data", "stats") ?? at(stats.json, "data");
      rows.push(...dayRows({ data: stat }));
    }
  }

  return rows;
};

export const DATA_CASES: readonly Case[] = [
  {
    id: 25,
    issue: "OUT-160",
    p1: false,
    run: async (ctx) => {
      const outbound = createOutbound({
        ...(await ctx.sdkOptions()),
        plugins: [sync({ checkpoints: memoryCheckpointStore() })],
      });

      let last: SyncResult | undefined;
      const seen = { records: 0 };

      for (let index = 0; index < 2; index += 1) {
        ctx.budget.check();
        last = await ctx.settle(
          outbound.sync.run("replies", {
            limit: 20,
            maxPages: 1,
            onPage: (items) => {
              seen.records += items.length;
            },
          })
        );
        ctx.budget.spend(last.requests);
      }

      return last === undefined
        ? skip(`no sync ran (${seen.records} records)`)
        : judgeSync(last);
    },
    title: "incremental sync",
  },
  {
    id: 26,
    issue: "OUT-161",
    p1: false,
    run: async (ctx) => {
      const leads = await ctx.cli([
        "leads",
        "--limit",
        "1",
        "--provider",
        "all",
        "--compact",
      ]);

      return judgeTruncation(leads.code, leads.json);
    },
    title: "CLI truncation",
  },
  {
    id: 27,
    issue: "none",
    p1: false,
    run: async (ctx) => {
      const from = dayBefore(ctx, WEEK);
      const to = dayBefore(ctx, 1);

      const workspace = await ctx.cli([
        "stats",
        "--scope",
        "workspace",
        "--by",
        "day",
        "--from",
        from,
        "--to",
        to,
        "--provider",
        "all",
        "--compact",
      ]);

      const senders = await ctx.cli([
        "stats",
        "--scope",
        "sender",
        "--by",
        "day",
        "--from",
        from,
        "--to",
        to,
        "--provider",
        "all",
        "--compact",
      ]);

      const campaigns = await campaignDays(ctx, from, to);

      const byCampaign =
        typeof campaigns === "string"
          ? skip(campaigns)
          : judgeDailySums("campaign", dayRows(workspace.json), campaigns);

      const bySender =
        senders.code === 0
          ? judgeDailySums(
              "sender",
              dayRows(workspace.json),
              dayRows(senders.json)
            )
          : skip(`stats --scope sender exited ${senders.code}`);

      const failed = [byCampaign, bySender].find(
        (verdict) => verdict.status === "fail"
      );

      if (failed !== undefined) {
        return failed;
      }

      const detail = `${byCampaign.detail}; ${bySender.detail}`;

      return byCampaign.status === "skip" && bySender.status === "skip"
        ? skip(detail)
        : pass(detail);
    },
    title: "daily stats",
  },
  {
    id: 28,
    issue: "OUT-167",
    p1: false,
    run: async (ctx) => {
      const days = 14;

      const stats = await ctx.cli([
        "stats",
        "--scope",
        "workspace",
        "--by",
        "day",
        "--from",
        dayBefore(ctx, days),
        "--to",
        dayBefore(ctx, 1),
        "--provider",
        "all",
        "--compact",
      ]);

      if (stats.code !== 0) {
        return fail(`stats --by day exited ${stats.code}`);
      }

      const rows = list(at(stats.json, "data", "rows"));

      const providers = [
        ...new Set(rows.map((row) => text(at(row, "provider")) ?? "")),
      ];

      return judgeMissingDays(
        rows,
        days,
        providers,
        list(at(stats.json, "meta", "notes")).map(String)
      );
    },
    title: "missing days",
  },
  {
    id: 29,
    issue: "OUT-162",
    p1: false,
    run: async (ctx) => {
      const period = await ctx.mcp().call("period_comparison");

      if (period.isError) {
        return fail(`period_comparison answered ${codeOf(period)}`);
      }

      const rows = list(at(period.structured, "data", "campaigns"));
      const withoutMeetings: string[] = [];

      for (const provider of new Set(
        rows.map((row) => text(at(row, "provider")) ?? "")
      )) {
        const capabilities = await ctx.cli([
          "capabilities",
          "--provider",
          provider,
          "--compact",
        ]);

        if (recordsNoMeetings(at(capabilities.json, "data", "fields"))) {
          withoutMeetings.push(provider);
        }
      }

      return judgeMeetings(rows, withoutMeetings);
    },
    title: "meetings",
  },
  {
    id: 30,
    issue: "OUT-169",
    p1: false,
    run: async (ctx) => {
      const answers: unknown[] = [];
      const campaigns = await activeCampaigns(ctx);

      for (const campaign of campaigns.slice(0, 3)) {
        const outcome = await callCheck(ctx, "copy_review", "variants", {
          campaign,
        });

        if (!outcome.isError) {
          answers.push(outcome.structured);
        }
      }

      const truth = { biggestCampaign: campaigns[0] ?? null };

      return answers.length === 0
        ? skip("variant_test answered for no campaign", truth)
        : { ...judgeVariantTest(answers), truth };
    },
    title: "variant_test",
  },
];
