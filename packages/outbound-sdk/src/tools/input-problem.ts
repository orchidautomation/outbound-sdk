// The sentence for an input its schema refuses, shared by the built-in tools
// and the insights so both read the same: "`campaign` is required" for a
// field left out, otherwise the field and the schema's own message.

import { isJsonObject } from "../internal/json.ts";
import type { Json } from "../internal/json.ts";

/** The part of a schema issue the sentence needs. */
export interface InputIssue {
  readonly path: readonly PropertyKey[];
  readonly message: string;
}

/** Whether the input leaves out the top-level field at `path`. */
const isAbsent = (
  input: Json | undefined,
  path: readonly PropertyKey[]
): boolean => {
  const [key] = path;

  return (
    path.length === 1 &&
    key !== undefined &&
    (!isJsonObject(input) || input[String(key)] === undefined)
  );
};

/** "`campaign` is required", or "from Use YYYY-MM-DD" for a value given wrong. */
export const inputProblem = (
  input: Json | undefined,
  issue: InputIssue | undefined
): string => {
  const path = issue?.path.join(".") || "input";

  return isAbsent(input, issue?.path ?? [])
    ? `\`${path}\` is required`
    : `${path} ${issue?.message ?? "is invalid"}`;
};
