// The senders insights. Each file in this folder defines one; this list is what
// the registry reads.

import { bounceWatch } from "./bounce-watch.ts";
import { domainHealth } from "./domain-health.ts";
import { senderCapacity } from "./sender-capacity.ts";
import { senderLoad } from "./sender-load.ts";
import { settingsAudit } from "./settings-audit.ts";
import { warmupReadiness } from "./warmup-readiness.ts";

export const SENDERS_INSIGHTS = [
  domainHealth,
  senderCapacity,
  bounceWatch,
  warmupReadiness,
  senderLoad,
  settingsAudit,
] as const;

export type {
  BounceCampaign,
  BounceCounts,
  BounceSender,
  BounceUnknown,
  BounceWatch,
} from "./bounce-watch.ts";

export type {
  DomainHealth,
  DomainMailbox,
  DomainReport,
  DomainRisk,
  DomainWarmup,
  LinkedinSeat,
} from "./domain-health.ts";

export type { DnsRecord } from "./read.ts";

export type {
  CapacityAsk,
  CapacitySends,
  CapacityTotals,
  SenderCapacity,
  ShortCampaign,
} from "./sender-capacity.ts";

export type {
  CampaignSenderIssue,
  CampaignSenderRisk,
  LoadedSender,
  OverusedSender,
  SenderLoad,
} from "./sender-load.ts";

export type {
  AuditedCampaign,
  SettingsAudit,
  SettingsCheck,
  SettingsCheckCounts,
  SettingsFinding,
  SettingsSeverity,
} from "./settings-audit.ts";

export type {
  ReadinessCounts,
  ReadinessReason,
  UnreadySender,
  WarmupReadiness,
} from "./warmup-readiness.ts";
