// npm run eval: the deterministic invariant runner (layer 1).
//
//   npm run eval                         offline, over fixtures, prints the summary
//   LIVE_TESTS=1 npm run eval            live, read-only, writes ~/outbound-evals/
//   ... -- --checkout <path>             live, against another worktree's CLI
//   ... -- --cases 1,4,9 --max-requests 500 --out <dir>
//
// Exit 0 when no P1-linked case fails, 1 when one does (a red run), 2 for a
// bad flag, 75 when another run holds the lock.

import { execFileSync } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import path from "node:path";
import { parseArgs } from "node:util";

import { packageVersion } from "../packages/outbound-sdk/src/cli/version.ts";
import { createContext } from "./context.ts";
import { LockedError, takeLock } from "./lock.ts";
import {
  assertCountsOnly,
  previousResult,
  stamp,
  statusChanges,
  statusRows,
} from "./report.ts";
import { runCases } from "./suite.ts";
import type { SuiteResult } from "./suite.ts";

const noop = (): void => undefined;

export const RESULTS_DIR = path.join(homedir(), "outbound-evals");

/** Sized from the first live run: the 32 cases spent about 2,000 by case 24, with suppression and collisions about 700 each. */
export const DEFAULT_MAX_REQUESTS = 4000;

export interface InvariantRun extends SuiteResult {
  readonly layer: "invariants";
  readonly mode: "live" | "offline";
  readonly commit: string | null;
  readonly version: string;
  readonly startedAt: string;
  readonly seconds: number;
  readonly maxRequests: number;
}

export const commitOf = (dir: string): string | null => {
  try {
    return execFileSync("git", ["-C", dir, "rev-parse", "--short", "HEAD"], {
      encoding: "utf-8",
    }).trim();
  } catch {
    return null;
  }
};

const changeLine = (changes: readonly string[], previous: unknown): string => {
  if (changes.length > 0) {
    return `Changed since the last run: ${changes.join("; ")}.`;
  }

  return previous === undefined
    ? "No earlier run to compare."
    : "No case changed since the last run.";
};

/** The counts-only markdown summary of a run, with what changed since `previous`. */
export const summarize = (result: InvariantRun, previous: unknown): string => {
  const count = (status: string): number =>
    result.cases.filter((one) => one.status === status).length;

  const changes =
    previous === undefined
      ? []
      : statusChanges(
          statusRows(previous, "cases"),
          statusRows(result, "cases")
        );

  const lines = [
    `### Eval invariants: ${result.red ? "red" : "green"} (${result.mode}, ${result.version}${result.commit === null ? "" : ` at ${result.commit}`})`,
    "",
    `${count("pass")} pass, ${count("fail")} fail, ${count("skip")} skip of ${result.cases.length} cases. ${result.requests} vendor requests (budget ${result.maxRequests}), ${Math.round(result.seconds)} s.`,
    "",
    changeLine(changes, previous),
    "",
    "| # | Case | Issue | P1 | Result | Requests | Seconds | Detail |",
    "|---|---|---|---|---|---|---|---|",
    ...result.cases.map(
      (one) =>
        `| ${one.id} | ${one.title} | ${one.issue} | ${one.p1 ? "yes" : ""} | ${one.status} | ${one.requests} | ${Math.round(one.ms / 1000)} | ${one.detail.replaceAll("|", "/")} |`
    ),
  ];

  return assertCountsOnly(lines.join("\n"));
};

const main = async (): Promise<number> => {
  const { values } = parseArgs({
    options: {
      cases: { type: "string" },
      checkout: { type: "string" },
      live: { type: "boolean" },
      "max-requests": { type: "string" },
      out: { type: "string" },
    },
  });

  const live = values.live === true || process.env.LIVE_TESTS === "1";
  const maxRequests = Number(values["max-requests"] ?? DEFAULT_MAX_REQUESTS);

  const only =
    values.cases === undefined
      ? undefined
      : new Set(values.cases.split(",").map(Number));

  const checkout = path.resolve(
    values.checkout ?? path.join(import.meta.dirname, "..")
  );

  if (!Number.isInteger(maxRequests) || maxRequests < 1) {
    process.stderr.write("--max-requests takes a positive whole number\n");

    return 2;
  }

  const out = values.out ?? (live ? RESULTS_DIR : undefined);
  let release = noop;

  if (live) {
    try {
      release = takeLock(RESULTS_DIR);
    } catch (error) {
      if (error instanceof LockedError) {
        process.stderr.write(`${error.message}; try again when it finishes\n`);

        return 75;
      }

      throw error;
    }
  }

  try {
    const started = Date.now();
    const clockStart = performance.now();
    const bin = path.join(checkout, "packages/outbound-sdk/src/cli/bin.ts");
    const ctx = createContext({ bin, live, maxRequests });
    const suite = await runCases(ctx, only);
    await ctx.close();

    const result: InvariantRun = {
      ...suite,
      commit: commitOf(checkout),
      layer: "invariants",
      maxRequests,
      mode: live ? "live" : "offline",
      seconds: (performance.now() - clockStart) / 1000,
      startedAt: new Date(started).toISOString(),
      version: packageVersion(),
    };

    const name = `${stamp(started)}.invariants`;

    const summary = summarize(
      result,
      out === undefined
        ? undefined
        : previousResult(out, "invariants", result.mode, `${name}.json`)
    );

    if (out !== undefined) {
      mkdirSync(out, { recursive: true });
      writeFileSync(
        path.join(out, `${name}.json`),
        `${JSON.stringify(result, null, 2)}\n`
      );
      writeFileSync(path.join(out, `${name}.md`), `${summary}\n`);
    }

    process.stdout.write(`${summary}\n`);

    return result.red ? 1 : 0;
  } finally {
    release();
  }
};

if (import.meta.main) {
  process.exitCode = await main();
}
