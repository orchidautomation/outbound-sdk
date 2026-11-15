// Validating a check: every problem at once, each at its path, with what to
// write instead. Zod finds what is malformed; the hints here turn its issues
// into fixes, and the metric's own rules are checked beside them.

import { z } from "zod";

import {
  baseSchema,
  CHECK_METRICS,
  fitIssues,
  looseCheck,
  OP_ALIASES,
} from "./check-schema.ts";
import type { Check } from "./check-schema.ts";

export interface CheckIssue {
  /** Where the problem is, like `scope.person` or `value`. Empty for the whole check. */
  readonly path: string;
  /** What is wrong and what to write instead. */
  readonly message: string;
}

export type CheckValidation =
  | { readonly ok: true; readonly check: Check }
  | { readonly ok: false; readonly issues: readonly CheckIssue[] };

// What a field written under another name should be, by where it was found.
const KEY_HINTS = new Map<string, ReadonlyMap<string, string>>([
  [
    "",
    new Map([
      ["days", "window: { days }"],
      ["minSent", "min_sent"],
      ["operator", "op"],
      ["threshold", "value"],
    ]),
  ],
  [
    "scope",
    new Map([
      ["campaignId", "campaign"],
      ["lead", "person"],
      ["senderId", "sender"],
    ]),
  ],
]);

const unknownKey = (key: string, where: string): string => {
  const hint = KEY_HINTS.get(where)?.get(key);

  return hint === undefined
    ? `${key} is not a check field`
    : `${key} is not a check field: write ${hint}`;
};

const snake = (text: string): string =>
  text
    .replaceAll(/(?<lower>[a-z])(?<upper>[A-Z])/gu, "$<lower>_$<upper>")
    .replaceAll(/[\s-]+/gu, "_")
    .toLowerCase();

// The metric and operator as written, when they are strings, for a hint.
const written = z
  .object({
    metric: z.string().optional().catch(undefined),
    op: z.string().optional().catch(undefined),
  })
  .catch({ metric: undefined, op: undefined });

type Written = z.infer<typeof written>;

const hintFor = (path: string, given: Written, message: string): string => {
  const close = given.metric === undefined ? undefined : snake(given.metric);

  if (path === "metric" && close !== undefined && close in CHECK_METRICS) {
    return `${message}. Did you mean ${close}?`;
  }

  const alias = given.op === undefined ? undefined : OP_ALIASES.get(given.op);

  return path === "op" && alias !== undefined
    ? `${message}. Write ${alias} for ${given.op}`
    : message;
};

const toIssues = (error: z.ZodError, given: Written): CheckIssue[] =>
  error.issues.flatMap((issue) => {
    const where = issue.path.join(".");

    if (issue.code === "unrecognized_keys") {
      return issue.keys.map((key) => ({
        message: unknownKey(key, where),
        path: where === "" ? key : `${where}.${key}`,
      }));
    }

    if (where === "" && issue.code === "invalid_type") {
      return [{ message: "a check is a JSON object", path: "" }];
    }

    return [{ message: hintFor(where, given, issue.message), path: where }];
  });

/** Validates a check and lists every problem with its fix, without throwing. */
// oxlint-disable-next-line anti-slop/no-unknown-parameters -- the boundary: a check arrives as parsed JSON and is validated here
export const validateCheck = (input: unknown): CheckValidation => {
  const parsed = baseSchema.safeParse(input);
  const loose = looseCheck.safeParse(input);

  const issues = [
    ...(parsed.success ? [] : toIssues(parsed.error, written.parse(input))),
    ...(loose.success ? fitIssues(loose.data) : []).map((issue) => ({
      message: issue.message,
      path: issue.path.join("."),
    })),
  ];

  return parsed.success && issues.length === 0
    ? { check: parsed.data, ok: true }
    : { issues, ok: false };
};

/** One line per problem: `scope.person: bounce_rate cannot be narrowed by person…`. */
export const describeIssues = (issues: readonly CheckIssue[]): string =>
  issues
    .map((issue) =>
      issue.path === "" ? issue.message : `${issue.path}: ${issue.message}`
    )
    .join("\n");
