// outbound-sdk/alerts: fixed rules, checked after reads. A rule is plain
// arithmetic on what was just read; no model is involved. When a rule fires,
// your `notify` function is called. It is fire-and-forget: a notifier that
// fails cannot fail the read.

export {
  alerts,
  bounceRateAbove,
  noSends,
  replyRateBelow,
  senderNotActive,
} from "./plugin.ts";

export type {
  Alert,
  AlertRule,
  AlertsExtension,
  AlertsOptions,
  RateRuleOptions,
} from "./plugin.ts";
