// Runway: cases 9 and 10.

import type { Case, Verdict } from "../case.ts";
import { fail, firstFailure, skip } from "../case.ts";
import { at, bool, list, num, text } from "../json.ts";
import { codeOf, itemsOf, plural } from "../shared.ts";

export interface RunwayRow {
  readonly pace: number | null;
  readonly daysLeft: number | null;
  readonly remaining: number | null;
  readonly state: string | null;
}

/** Case 9: no days without a pace, and N left at pace P lasts N / P days. */
export const judgeRunway = (rows: readonly RunwayRow[]): Verdict => {
  if (rows.length === 0) {
    return skip("no campaign runway to check");
  }

  const noPace = rows.filter(
    (row) => (row.pace === null || row.pace === 0) && row.daysLeft !== null
  ).length;

  const wrongDivision = rows.filter(
    (row) =>
      row.state === "draining" &&
      row.pace !== null &&
      row.pace > 0 &&
      row.remaining !== null &&
      row.daysLeft !== null &&
      Math.abs(row.daysLeft - row.remaining / row.pace) > 1
  ).length;

  return firstFailure(
    [
      noPace > 0
        ? `${noPace} of ${plural(rows.length, "campaign")} give days left with no pace`
        : null,
      wrongDivision > 0
        ? `${wrongDivision} of ${plural(rows.length, "campaign")} give days left that are not leads left ÷ pace`
        : null,
    ],
    `${plural(rows.length, "campaign runway")} consistent with leads left ÷ pace`
  );
};

export interface RunwayPair {
  readonly report: RunwayRow;
  readonly tool: RunwayRow;
  readonly reportComplete: boolean | null;
  readonly toolComplete: boolean | null;
}

const sameDays = (left: number | null, right: number | null): boolean =>
  left === null || right === null
    ? left === right
    : Math.abs(left - right) < 0.05;

/** Case 10: client_report and lead_runway agree on a campaign's runway. */
export const judgeRunwayAgreement = (pairs: readonly RunwayPair[]): Verdict => {
  if (pairs.length === 0) {
    return skip("client_report listed no campaign runway to compare");
  }

  const differ = pairs.filter(
    (pair) =>
      !sameDays(pair.report.daysLeft, pair.tool.daysLeft) ||
      pair.report.state !== pair.tool.state
  ).length;

  const completeness = pairs.filter(
    (pair) => pair.toolComplete === false && pair.reportComplete !== false
  ).length;

  return firstFailure(
    [
      differ > 0
        ? `client_report and lead_runway differ on ${differ} of ${plural(pairs.length, "campaign")}`
        : null,
      completeness > 0
        ? `lead_runway stopped counting on ${completeness} campaigns that client_report calls complete`
        : null,
    ],
    `client_report and lead_runway agree on ${plural(pairs.length, "campaign")}`
  );
};

const reportRow = (row: unknown): RunwayRow => ({
  daysLeft: num(at(row, "daysLeft")),
  pace: num(at(row, "dailyContactRate")),
  remaining: num(at(row, "remaining")),
  state: text(at(row, "state")),
});

const toolRow = (structured: unknown): RunwayRow => ({
  daysLeft: num(at(structured, "data", "runway_days")),
  pace: num(at(structured, "data", "contacted_per_day")),
  remaining:
    num(at(structured, "data", "not_started")) ??
    num(at(structured, "data", "active_leads")),
  state: text(at(structured, "data", "state")),
});

const runwayRows = (structured: unknown): unknown[] => [
  ...list(at(structured, "data", "runningOutOfLeads")),
  ...list(at(structured, "data", "stalled")),
];

const COMPARED = 3;

export const RUNWAY_CASES: readonly Case[] = [
  {
    id: 9,
    issue: "OUT-147",
    p1: true,
    run: async (ctx) => {
      const report = await ctx.mcp().call("client_report");

      if (report.isError) {
        return fail(`client_report answered ${codeOf(report)}`);
      }

      const verdict = judgeRunway(runwayRows(report.structured).map(reportRow));
      const running = itemsOf(report, "runningOutOfLeads");

      return {
        ...verdict,
        truth: {
          outOfLeadsNow: running.filter(
            (row) => text(at(row, "state")) === "out_of_leads"
          ).length,
          runningOut: running.length,
          runningOutThisWeek: running.filter(
            (row) => (num(at(row, "daysLeft")) ?? Number.POSITIVE_INFINITY) <= 7
          ).length,
          stalled: itemsOf(report, "stalled").length,
        },
      };
    },
    title: "runway",
  },
  {
    id: 10,
    issue: "OUT-147",
    p1: true,
    run: async (ctx) => {
      const report = await ctx.mcp().call("client_report");

      if (report.isError) {
        return fail(`client_report answered ${codeOf(report)}`);
      }

      const pairs: RunwayPair[] = [];

      for (const row of runwayRows(report.structured).slice(0, COMPARED)) {
        const campaign = text(at(row, "campaign"));

        if (campaign !== null) {
          const tool = await ctx.mcp().call("lead_runway", {
            campaign,
            lookback_days: 7,
            max_leads: 5000,
          });

          if (tool.isError) {
            return fail(
              `lead_runway answered ${codeOf(tool)} for a campaign client_report reported`
            );
          }

          pairs.push({
            report: reportRow(row),
            reportComplete: bool(at(report.structured, "meta", "complete")),
            tool: toolRow(tool.structured),
            toolComplete: tool.complete,
          });
        }
      }

      return judgeRunwayAgreement(pairs);
    },
    title: "runway agreement",
  },
];
