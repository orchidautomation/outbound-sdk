// A check written as data: which number to read, how to compare it, with
// what, and for which client, campaign, sender or person. Plain JSON, so it
// can be stored, shown in a settings screen and edited. Validation names
// each problem with the fix, so a check is right the second time at worst.

import { z } from "zod";

import { senderStatusSchema } from "../internal/entities.ts";

/** What a metric is read from: a stats row, a sender, or one insight's answer. */
export type CheckSource =
  | "droppedReplies"
  | "personalizationGaps"
  | "pipelineForecast"
  | "senders"
  | "stats"
  | "suppressionCheck";

export type ScopeKey = "campaign" | "client" | "person" | "sender";

export interface CheckMetric {
  /** What to read, and so what to pass to `evaluateCheck`. */
  readonly reads: CheckSource;
  /** `rate` is a fraction from 0 to 1; `status` compares a sender status. */
  readonly unit: "count" | "days" | "hours" | "rate" | "status";
  /** The scope keys this metric can be narrowed by. */
  readonly scope: readonly ScopeKey[];
  readonly description: string;
}

const STATS_SCOPE: readonly ScopeKey[] = ["client", "campaign", "sender"];

/** Every metric a data check can read. */
export const CHECK_METRICS = {
  blocked_leads: {
    description:
      "Leads in a campaign that are on a block list, per campaign. Read with `suppressionCheck`.",
    reads: "suppressionCheck",
    scope: ["client", "campaign"],
    unit: "count",
  },
  bounce_rate: {
    description:
      "Bounced divided by sent, per stats row. Rows with fewer than `min_sent` sends are skipped.",
    reads: "stats",
    scope: STATS_SCOPE,
    unit: "rate",
  },
  broken_variable_leads: {
    description:
      "Leads who get broken copy from one merge variable with no value and no fallback, per variable. Read with `personalizationGaps`.",
    reads: "personalizationGaps",
    scope: ["client", "campaign"],
    unit: "count",
  },
  lead_runway_days: {
    description:
      "Days until a campaign runs out of leads at its recent contact rate. Read with `pipelineForecast`.",
    reads: "pipelineForecast",
    scope: ["client", "campaign"],
    unit: "days",
  },
  positive_reply_waiting_hours: {
    description:
      "Hours a positive reply has waited with no answer, per reply. Read with `droppedReplies`.",
    reads: "droppedReplies",
    scope: ["client", "campaign", "person"],
    unit: "hours",
  },
  reply_rate: {
    description:
      "Replies divided by leads contacted (or sent), per stats row. Rows with fewer than `min_sent` sends are skipped.",
    reads: "stats",
    scope: STATS_SCOPE,
    unit: "rate",
  },
  sender_status: {
    description:
      "A sender's status: active, paused, disconnected or error. A sender whose status is unknown is skipped.",
    reads: "senders",
    scope: ["client", "sender"],
    unit: "status",
  },
  sent: {
    description:
      "Messages sent, per stats row. With `window`, daily rows older than the window are skipped.",
    reads: "stats",
    scope: STATS_SCOPE,
    unit: "count",
  },
} as const satisfies Record<string, CheckMetric>;

export type CheckMetricName = keyof typeof CHECK_METRICS;

// SAFETY: CHECK_METRICS is a fixed, non-empty object, so its keys are exactly CheckMetricName.
const METRIC_NAMES = Object.keys(CHECK_METRICS) as [
  CheckMetricName,
  ...CheckMetricName[],
];

const NUMBER_OPS = [">", ">=", "<", "<=", "==", "!="] as const;

export type CheckOp = (typeof NUMBER_OPS)[number];

export const OP_ALIASES = new Map<string, CheckOp>([
  ["!==", "!="],
  ["<>", "!="],
  ["=", "=="],
  ["===", "=="],
  ["eq", "=="],
  ["gt", ">"],
  ["gte", ">="],
  ["lt", "<"],
  ["lte", "<="],
  ["ne", "!="],
  ["neq", "!="],
]);

const STATUSES: ReadonlySet<string> = new Set(senderStatusSchema.options);

// A ref is `provider:workspaceId:sourceId`, as every record carries it.
const REF = /^[^:\s]+:[^:\s]+:\S+$/u;

const ref = (what: string) =>
  z.string({ error: `must be the ${what}'s ref, a string` }).regex(REF, {
    error: `must be the ${what}'s ref, like "instantly:ws_1:abc123" (provider:workspaceId:id), not its name or address`,
  });

const scopeSchema = z.strictObject({
  campaign: ref("campaign").optional(),
  client: z
    .string({
      error: "must be the client's name as your clients rules give it",
    })
    .min(1, { error: "must not be empty" })
    .optional(),
  person: ref("lead").optional(),
  sender: ref("sender").optional(),
});

const windowSchema = z.strictObject({
  days: z
    .number({ error: "must be a whole number of days" })
    .int({ error: "must be a whole number of days" })
    .min(1, { error: "must be at least 1" })
    .max(366, { error: "must be at most 366" }),
});

// A missing field says so, rather than repeating what a wrong one should be.
const needs =
  (missing: string, wrong: string) =>
  (issue: { readonly input: unknown }): string =>
    issue.input === undefined ? `is required: ${missing}` : wrong;

export const baseSchema = z.strictObject({
  metric: z.enum(METRIC_NAMES, {
    error: needs(
      `the number to check, one of ${METRIC_NAMES.join(", ")}`,
      `must be one of ${METRIC_NAMES.join(", ")}`
    ),
  }),
  min_sent: z
    .number({ error: "must be a whole number of sends" })
    .int({ error: "must be a whole number of sends" })
    .min(0, { error: "must be 0 or more" })
    .optional(),
  name: z
    .string({ error: "must be a string" })
    .min(1, { error: "must not be empty" })
    .optional(),
  op: z.enum(NUMBER_OPS, {
    error: needs(
      `how to compare, one of ${NUMBER_OPS.join(" ")}`,
      `must be one of ${NUMBER_OPS.join(" ")}`
    ),
  }),
  scope: scopeSchema.optional(),
  value: z.union([z.number(), z.string()], {
    error: needs(
      "what to compare with, such as 0.03 for a 3% rate",
      "must be a number, or a sender status for sender_status"
    ),
  }),
  window: windowSchema.optional(),
});

export interface Fit {
  readonly path: readonly string[];
  readonly message: string;
}

type Given =
  | { readonly kind: "none" }
  | { readonly kind: "number"; readonly value: number }
  | { readonly kind: "string"; readonly value: string };

// The fields the metric-dependent rules read, each as given or absent, so
// they can be checked while another field is still wrong.
export const looseCheck = z.object({
  metric: z.enum(METRIC_NAMES),
  min_sent: z
    .unknown()
    .optional()
    .transform((value) => value !== undefined),
  op: z.string().optional().catch(undefined),
  scope: z.record(z.string(), z.unknown()).optional().catch(undefined),
  value: z
    .union([
      z.number().transform((value): Given => ({ kind: "number", value })),
      z.string().transform((value): Given => ({ kind: "string", value })),
    ])
    .catch({ kind: "none" }),
  window: z
    .unknown()
    .optional()
    .transform((value) => value !== undefined),
});

type LooseCheck = z.infer<typeof looseCheck>;

const statusFits = (given: Given): string | null =>
  given.kind === "none" ||
  (given.kind === "string" && STATUSES.has(given.value))
    ? null
    : `sender_status compares a status: one of ${senderStatusSchema.options.join(", ")}`;

const numberFits = (
  metric: CheckMetricName,
  unit: CheckMetric["unit"],
  given: Given
): string | null => {
  if (given.kind === "string") {
    return `${metric} compares a number, not ${JSON.stringify(given.value)}`;
  }

  if (given.kind === "none") {
    return null;
  }

  const { value } = given;

  if (unit === "rate" && (value < 0 || value > 1)) {
    return value > 1 && value <= 100
      ? `${metric} is a fraction from 0 to 1: write ${value / 100} for ${value}%`
      : `${metric} is a fraction from 0 to 1`;
  }

  return value < 0 ? `${metric} is never below 0` : null;
};

const optionIssues = (check: LooseCheck, metric: CheckMetric): Fit[] => [
  ...(check.window && metric.reads !== "stats"
    ? [
        {
          message: `${check.metric} takes no window: the ${metric.reads} read you pass sets its period`,
          path: ["window"],
        },
      ]
    : []),
  ...(check.min_sent && metric.unit !== "rate"
    ? [
        {
          message: "min_sent applies only to bounce_rate and reply_rate",
          path: ["min_sent"],
        },
      ]
    : []),
];

/**
 * The rules that depend on the metric: what its value is, which operators,
 * scope keys and options it takes. Read from the input as given, so they are
 * reported beside a wrong field elsewhere rather than after it is fixed.
 */
export const fitIssues = (check: LooseCheck): Fit[] => {
  const metric: CheckMetric = CHECK_METRICS[check.metric];
  const issues: Fit[] = [];

  const valueIssue =
    metric.unit === "status"
      ? statusFits(check.value)
      : numberFits(check.metric, metric.unit, check.value);

  if (valueIssue !== null) {
    issues.push({ message: valueIssue, path: ["value"] });
  }

  if (
    metric.unit === "status" &&
    check.op !== undefined &&
    check.op !== "==" &&
    check.op !== "!="
  ) {
    issues.push({
      message: `sender_status takes == or !=, not ${check.op}`,
      path: ["op"],
    });
  }

  for (const key of Object.keys(check.scope ?? {})) {
    if (
      key in scopeSchema.shape &&
      !metric.scope.some((each) => each === key)
    ) {
      issues.push({
        message: `${check.metric} cannot be narrowed by ${key}. It takes ${metric.scope.join(", ")}`,
        path: ["scope", key],
      });
    }
  }

  return [...issues, ...optionIssues(check, metric)];
};

/**
 * The Zod schema of a data check. `z.toJSONSchema(checkSchema)` gives a JSON
 * Schema for an editor or a model's structured output. `validateCheck` gives
 * the same verdict with every problem listed at once.
 */
export const checkSchema = baseSchema.superRefine((check, ctx) => {
  for (const issue of fitIssues(looseCheck.parse(check))) {
    ctx.addIssue({
      code: "custom",
      message: issue.message,
      path: [...issue.path],
    });
  }
});

/** A data check, as written in JSON. */
export type Check = z.infer<typeof checkSchema>;
