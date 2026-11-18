// What an invariant case is, and what it reports.

import type { Context } from "./context.ts";

export type Status = "pass" | "fail" | "skip";

/** Ground truth for the agent tasks: counts and flags only, never a person. */
export type Truth = Readonly<Record<string, number | boolean | string | null>>;

export interface Verdict {
  readonly status: Status;
  /** Counts and tool names only. */
  readonly detail: string;
  readonly truth?: Truth | undefined;
}

export interface Case {
  readonly id: number;
  readonly title: string;
  readonly issue: string;
  /** A failing P1-linked case makes the run red. */
  readonly p1: boolean;
  readonly run: (ctx: Context) => Promise<Verdict>;
}

export const pass = (detail: string, truth?: Truth): Verdict => ({
  detail,
  status: "pass",
  truth,
});

export const fail = (detail: string, truth?: Truth): Verdict => ({
  detail,
  status: "fail",
  truth,
});

export const skip = (detail: string, truth?: Truth): Verdict => ({
  detail,
  status: "skip",
  truth,
});

/** The first failure among checks run in order, or a pass with `detail`. */
export const firstFailure = (
  failures: readonly (string | null)[],
  detail: string,
  truth?: Truth
): Verdict => {
  const failed = failures.find((failure) => failure !== null);

  return failed === undefined || failed === null
    ? pass(detail, truth)
    : fail(failed, truth);
};
