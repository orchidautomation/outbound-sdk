// outbound-sdk/reconcile: webhooks arrive late, twice or not at all, and list
// calls stop returning deleted records. This compares what you received with
// what the vendor lists, and reports the difference. A mismatch is reported,
// never hidden or silently repaired.

export { reconcile } from "./plugin.ts";

export type {
  DeletionCheck,
  DeletionReport,
  EventCheck,
  EventReport,
  ReceivedEvent,
  ReconcileExtension,
} from "./plugin.ts";
