// The files a run leaves: one JSON and one markdown summary, on the machine
// that ran it. The markdown is what goes to Linear, so it holds counts,
// pass/fail and timings only, and is refused if anything looks personal.

import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";

import { at, isRecord, list, parsed, text } from "./json.ts";

/** Text that names or reaches a person: an address, a profile, a link, a redact token, a vendor id. */
const PERSONAL = [
  /[\w.+-]+@[\w-]+\.[\w.]+/u,
  /linkedin\.com/iu,
  /https?:\/\//iu,
  /redacted:[0-9a-f]+/iu,
  /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}/iu,
];

export class PersonalDataError extends Error {
  constructor(pattern: RegExp) {
    super(
      `the summary matches ${String(pattern)}, so it is not written or posted`
    );
    this.name = "PersonalDataError";
  }
}

/** Throws when `summary` holds anything that looks like personal data. */
export const assertCountsOnly = (summary: string): string => {
  const hit = PERSONAL.find((pattern) => pattern.test(summary));

  if (hit !== undefined) {
    throw new PersonalDataError(hit);
  }

  return summary;
};

export interface StatusRow {
  readonly id: string;
  readonly status: string;
}

/** Rows whose status changed since the previous run. */
export const statusChanges = (
  previous: readonly StatusRow[],
  current: readonly StatusRow[]
): string[] =>
  current.flatMap((row) => {
    const before = previous.find((old) => old.id === row.id)?.status;

    return before === undefined || before === row.status
      ? []
      : [`${row.id}: ${before} → ${row.status}`];
  });

/** The newest earlier result file of the same layer and mode in `dir`, if any. */
export const previousResult = (
  dir: string,
  layer: string,
  mode: string,
  except: string
): unknown => {
  let names: string[];

  try {
    names = readdirSync(dir)
      .filter((name) => name.endsWith(`.${layer}.json`) && name !== except)
      .toSorted();
  } catch {
    return undefined;
  }

  for (const name of names.toReversed()) {
    const result = parsed(readFileSync(path.join(dir, name), "utf-8"));

    if (isRecord(result) && result.mode === mode) {
      return result;
    }
  }

  return undefined;
};

export const statusRows = (result: unknown, key: string): StatusRow[] =>
  list(at(result, key)).map((row) => ({
    id: String(at(row, "id")),
    status: text(at(row, "status")) ?? "?",
  }));

export const stamp = (ms: number): string =>
  new Date(ms).toISOString().replaceAll(":", "").slice(0, 15);
