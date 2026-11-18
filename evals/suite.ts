// Every invariant case, in the order a run takes them: the cheap P1 cases
// first, so a spent request budget skips the costly ones, not those.

import type { Case, Status, Truth } from "./case.ts";
import { skip } from "./case.ts";
import { COVERAGE_CASES } from "./cases/coverage.ts";
import { DATA_CASES } from "./cases/data.ts";
import { PEOPLE_CASES } from "./cases/people.ts";
import { REPLY_CASES } from "./cases/replies.ts";
import { RUNWAY_CASES } from "./cases/runway.ts";
import { SURFACE_CASES } from "./cases/surface.ts";
import { BudgetSpentError } from "./context.ts";
import type { Context } from "./context.ts";

const ORDER = [
  1, 2, 3, 4, 5, 7, 9, 10, 11, 12, 24, 8, 13, 14, 15, 17, 18, 20, 21, 22, 23,
  25, 26, 27, 28, 29, 30, 31, 6, 16, 32, 19,
];

const ALL = [
  ...REPLY_CASES,
  ...RUNWAY_CASES,
  ...COVERAGE_CASES,
  ...SURFACE_CASES,
  ...PEOPLE_CASES,
  ...DATA_CASES,
];

export const CASES: readonly Case[] = ORDER.flatMap((id) =>
  ALL.filter((one) => one.id === id)
);

export interface CaseResult {
  readonly id: number;
  readonly title: string;
  readonly issue: string;
  readonly p1: boolean;
  readonly status: Status;
  readonly detail: string;
  readonly ms: number;
  readonly requests: number;
}

export interface SuiteResult {
  readonly cases: readonly CaseResult[];
  readonly truth: Readonly<Record<string, Truth>>;
  readonly requests: number;
  /** A P1-linked case failed. */
  readonly red: boolean;
}

export const runCases = async (
  ctx: Context,
  only?: ReadonlySet<number>
): Promise<SuiteResult> => {
  const cases: CaseResult[] = [];
  const truth: Record<string, Truth> = {};

  for (const one of CASES.filter(
    (candidate) => only === undefined || only.has(candidate.id)
  )) {
    const started = ctx.now();
    const spentBefore = ctx.spent();
    let verdict;

    try {
      verdict = await one.run(ctx);
    } catch (error) {
      verdict =
        error instanceof BudgetSpentError
          ? skip(error.message)
          : {
              detail: `the case itself failed: ${error instanceof Error ? error.name : "error"}`,
              status: "fail" as const,
            };
    }

    if (verdict.truth !== undefined) {
      truth[String(one.id)] = verdict.truth;
    }

    cases.push({
      detail: verdict.detail,
      id: one.id,
      issue: one.issue,
      ms: ctx.now() - started,
      p1: one.p1,
      requests: ctx.spent() - spentBefore,
      status: verdict.status,
      title: one.title,
    });
  }

  return {
    cases: cases.toSorted((left, right) => left.id - right.id),
    red: cases.some((result) => result.p1 && result.status === "fail"),
    requests: ctx.spent(),
    truth,
  };
};
