// outbound-sdk/alerts: fixed rules, checked after reads. A rule is plain
// arithmetic on what was just read; no model is involved. When a rule fires,
// your `notify` function is called. It is fire-and-forget: a notifier that
// fails cannot fail the read.

export {
  alerts,
  bounceRateAbove,
  memoryAlertDedupe,
  noSends,
  replyRateBelow,
  senderNotActive,
} from "./plugin.ts";

export type {
  Alert,
  AlertDedupe,
  AlertRule,
  AlertsExtension,
  AlertsOptions,
  RateRuleOptions,
} from "./plugin.ts";

// Checks written as data: a JSON object naming a metric, an operator and a
// value, validated with every problem's fix and evaluated against a read.
export { CHECK_METRICS, checkSchema } from "./check-schema.ts";

export { describeIssues, validateCheck } from "./check-validate.ts";

export { checkRule, evaluateCheck, parseCheck } from "./check-evaluate.ts";

export type {
  Check,
  CheckMetric,
  CheckMetricName,
  CheckOp,
  CheckSource,
  ScopeKey,
} from "./check-schema.ts";

export type { CheckIssue, CheckValidation } from "./check-validate.ts";

export type {
  CheckBreach,
  CheckResult,
  EvaluateCheckOptions,
} from "./check-evaluate.ts";

export type { CheckAnswer, CheckNumbers, CheckRead } from "./check-measure.ts";
