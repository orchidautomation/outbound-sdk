// Seed shapes for the in-memory adapter, and their conversion to entities.
// Seeds are short on purpose: only an id is required and everything else has
// a default, so a test or demo states only what it cares about.

import { leadProgressSchema, SCHEMA_VERSION } from "../internal/entities.ts";
import type {
  Campaign,
  CampaignStatus,
  Channel,
  Lead,
  LeadEngagement,
  LeadProgress,
  LeadStatus,
  MailProvider,
  Message,
  MetricRow,
  MeetingStatus,
  RecipientMailProvider,
  Reply,
  ReplyCategory,
  Sender,
  SenderStatus,
  Sequence,
} from "../internal/entities.ts";
import type { MetricCounts } from "../internal/metrics.ts";
import { recordBase, refTo } from "../internal/record.ts";
import type { Identity } from "../internal/record.ts";
import { makeRef } from "../internal/ref.ts";
import { stableId } from "../internal/sha256.ts";
import type {
  MemoryBlockEntry,
  MemoryHealth,
  MemoryList,
  MemoryPlacementTest,
  MemorySettings,
  MemoryTag,
  MemoryWebhook,
} from "./account.ts";

export interface MemoryVariant {
  readonly key?: string;
  readonly subject?: string;
  readonly body?: string;
}

export interface MemoryStep {
  readonly action?: string;
  readonly delayDays?: number;
  readonly variants: readonly MemoryVariant[];
  /** The step before this one. Defaults to the previous step in the list. */
  readonly parentIndex?: number;
  /** The outcome of the parent's condition that leads here. */
  readonly branch?: string;
}

export interface MemorySubsequence {
  readonly id: string;
  readonly name?: string;
  readonly steps: readonly MemoryStep[];
}

export interface MemoryCampaign {
  readonly id: string;
  readonly name?: string;
  readonly status?: CampaignStatus;
  readonly channel?: Channel;
  readonly createdAt?: string;
  readonly tags?: readonly string[];
  readonly steps?: readonly MemoryStep[];
  readonly settings?: MemorySettings;
  readonly subsequences?: readonly MemorySubsequence[];
}

export interface MemorySender {
  readonly id: string;
  readonly address?: string;
  readonly linkedinUrl?: string;
  readonly name?: string;
  readonly status?: SenderStatus;
  readonly dailyLimit?: number;
  readonly mailProvider?: MailProvider;
  readonly tags?: readonly string[];
  readonly warmup?: { readonly enabled: boolean; readonly score?: number };
  /** The campaigns this sender is attached to. */
  readonly campaignIds?: readonly string[];
  readonly health?: MemoryHealth;
}

export interface MemoryLead {
  readonly id: string;
  readonly campaignId?: string;
  readonly email?: string;
  readonly linkedinUrl?: string;
  readonly firstName?: string;
  readonly lastName?: string;
  readonly company?: string;
  readonly title?: string;
  /** The headline. `progress` and the outcome flags follow from it unless given. */
  readonly status?: LeadStatus;
  readonly progress?: LeadProgress;
  readonly replied?: boolean;
  readonly bounced?: boolean;
  readonly unsubscribed?: boolean;
  readonly custom?: Readonly<Record<string, string>>;
  readonly createdAt?: string;
  readonly engagement?: Partial<LeadEngagement>;
  readonly interest?: string;
  readonly interestCategory?: ReplyCategory;
  readonly companyLinkedinUrl?: string;
  readonly recipientMailProvider?: RecipientMailProvider;
  readonly location?: string;
  readonly meeting?: MeetingStatus;
  readonly phone?: string;
  readonly website?: string;
  readonly tags?: readonly string[];
  /** The saved lists the lead is on. */
  readonly listIds?: readonly string[];
}

export interface MemoryMessage {
  readonly id: string;
  readonly direction: "in" | "out";
  readonly sentAt: string;
  readonly campaignId?: string;
  readonly leadId?: string;
  readonly senderId?: string;
  readonly stepIndex?: number;
  readonly variantKey?: string;
  readonly threadId?: string;
  readonly subject?: string;
  readonly body?: string;
  /** Inbound only. */
  readonly category?: ReplyCategory;
  /** Inbound only. */
  readonly isAuto?: boolean;
  /** Inbound only. */
  readonly unread?: boolean;
}

export interface MemoryStats {
  /** `YYYY-MM-DD`. */
  readonly date: string;
  readonly campaignId: string;
  /** Set for a per-sender row. */
  readonly senderId?: string;
  /** Set for a per-step row. */
  readonly stepIndex?: number;
  /** Set, with `stepIndex`, for one variant of a step, the way a vendor that splits step stats by variant reports it. */
  readonly variantKey?: string;
  readonly counts: Partial<MetricCounts>;
}

export interface MemoryData {
  readonly campaigns?: readonly MemoryCampaign[];
  readonly senders?: readonly MemorySender[];
  readonly leads?: readonly MemoryLead[];
  readonly messages?: readonly MemoryMessage[];
  readonly stats?: readonly MemoryStats[];
  readonly lists?: readonly MemoryList[];
  readonly blocklist?: readonly MemoryBlockEntry[];
  readonly tags?: readonly MemoryTag[];
  readonly webhooks?: readonly MemoryWebhook[];
  readonly placementTests?: readonly MemoryPlacementTest[];
}

const base = (identity: Identity, sourceId: string) =>
  recordBase(identity, sourceId, null);

const refOrNull = refTo;

export const toCampaign = (
  identity: Identity,
  seed: MemoryCampaign
): Campaign => ({
  ...base(identity, seed.id),
  channel: seed.channel ?? "email",
  createdAt: seed.createdAt ?? null,
  name: seed.name ?? seed.id,
  status: seed.status ?? "active",
  tags: [...(seed.tags ?? [])],
});

const toSteps = (
  steps: readonly MemoryStep[],
  channel: Channel | undefined
): Sequence["steps"] =>
  steps.map((step, index) => ({
    action: step.action ?? (channel === "linkedin" ? "message" : "email"),
    branch: step.branch ?? null,
    delayDays: step.delayDays ?? null,
    index,
    parentIndex: step.parentIndex ?? (index === 0 ? null : index - 1),
    variants: step.variants.map((variant, variantIndex) => ({
      body: variant.body ?? null,
      contentHash: stableId(variant.subject, variant.body),
      subject: variant.subject ?? null,
      variantKey: variant.key ?? String.fromCodePoint(65 + variantIndex),
    })),
  }));

export const toSequence = (
  identity: Identity,
  seed: MemoryCampaign
): Sequence => ({
  ...base(identity, seed.id),
  campaignRef: makeRef(identity.provider, identity.workspaceId, seed.id),
  kind: "main",
  name: null,
  steps: toSteps(seed.steps ?? [], seed.channel),
});

export const toSubsequence = (
  identity: Identity,
  campaign: MemoryCampaign,
  seed: MemorySubsequence
): Sequence => ({
  ...base(identity, seed.id),
  campaignRef: makeRef(identity.provider, identity.workspaceId, campaign.id),
  kind: "subsequence",
  name: seed.name ?? seed.id,
  steps: toSteps(seed.steps, campaign.channel),
});

export const toSender = (identity: Identity, seed: MemorySender): Sender => ({
  ...base(identity, seed.id),
  address: seed.address?.trim().toLowerCase() ?? null,
  dailyLimit: seed.dailyLimit ?? null,
  kind: seed.linkedinUrl === undefined ? "mailbox" : "linkedin",
  linkedinUrl: seed.linkedinUrl ?? null,
  mailProvider: seed.mailProvider ?? null,
  name: seed.name ?? null,
  status: seed.status ?? "active",
  tags: [...(seed.tags ?? [])],
  warmup:
    seed.warmup === undefined
      ? null
      : { enabled: seed.warmup.enabled, score: seed.warmup.score ?? null },
});

const toEngagement = (seed: Partial<LeadEngagement>): LeadEngagement => ({
  clicks: seed.clicks ?? null,
  lastContactedAt: seed.lastContactedAt ?? null,
  lastOpenedAt: seed.lastOpenedAt ?? null,
  lastRepliedAt: seed.lastRepliedAt ?? null,
  opens: seed.opens ?? null,
  repliedStepIndex: seed.repliedStepIndex ?? null,
  replies: seed.replies ?? null,
  stepIndex: seed.stepIndex ?? null,
});

const PROGRESS: ReadonlySet<string> = new Set([
  "active",
  "completed",
  "paused",
  "skipped",
]);

// A seed states its headline; the parts follow from it unless given.
const standingOf = (seed: MemoryLead) => {
  const status = seed.status ?? "active";

  const flagOf = (given: boolean | undefined, outcome: LeadStatus) =>
    given ?? (status === outcome ? true : null);

  return {
    bounced: flagOf(seed.bounced, "bounced"),
    progress:
      seed.progress ??
      leadProgressSchema.parse(PROGRESS.has(status) ? status : "unknown"),
    replied: flagOf(seed.replied, "replied"),
    status,
    unsubscribed: flagOf(seed.unsubscribed, "unsubscribed"),
  };
};

export const toLead = (identity: Identity, seed: MemoryLead): Lead => ({
  ...base(identity, seed.id),
  ...standingOf(seed),
  campaignRef: refOrNull(identity, seed.campaignId),
  company: seed.company ?? null,
  companyLinkedinUrl: seed.companyLinkedinUrl ?? null,
  createdAt: seed.createdAt ?? null,
  custom: { ...seed.custom },
  email: seed.email?.trim().toLowerCase() ?? null,
  engagement:
    seed.engagement === undefined ? null : toEngagement(seed.engagement),
  firstName: seed.firstName ?? null,
  interest: seed.interest ?? null,
  interestCategory: seed.interestCategory ?? null,
  tags: [...(seed.tags ?? [])],
  lastName: seed.lastName ?? null,
  linkedinUrl: seed.linkedinUrl ?? null,
  location: seed.location ?? null,
  meeting: seed.meeting ?? null,
  phone: seed.phone ?? null,
  recipientMailProvider: seed.recipientMailProvider ?? null,
  title: seed.title ?? null,
  website: seed.website ?? null,
});

const messageFields = (
  identity: Identity,
  seed: MemoryMessage,
  channel: Channel,
  includeBody: boolean
) => ({
  ...base(identity, seed.id),
  bodyHtml: null,
  bodyText: includeBody ? (seed.body ?? null) : null,
  campaignRef: refOrNull(identity, seed.campaignId),
  channel,
  leadRef: refOrNull(identity, seed.leadId),
  senderRef: refOrNull(identity, seed.senderId),
  sentAt: seed.sentAt,
  stepIndex: seed.stepIndex ?? null,
  subject: seed.subject ?? null,
  threadId: seed.threadId ?? null,
  variantKey: seed.variantKey ?? null,
});

export const toMessage = (
  identity: Identity,
  seed: MemoryMessage,
  channel: Channel,
  includeBody: boolean
): Message => {
  const message: Message = {
    ...messageFields(identity, seed, channel, includeBody),
    direction: seed.direction,
  };

  // A seeded flag on a received message is the vendor's word.
  if (seed.direction === "in" && seed.isAuto !== undefined) {
    message.isAuto = seed.isAuto;
    message.isAutoSource = "vendor";
  }

  return message;
};

export const toReply = (
  identity: Identity,
  seed: MemoryMessage,
  channel: Channel,
  includeBody: boolean
): Reply => ({
  ...messageFields(identity, seed, channel, includeBody),
  category: seed.category ?? "unknown",
  categorySource: seed.category === undefined ? null : "vendor",
  direction: "in",
  isAuto: seed.isAuto ?? null,
  unread: seed.unread ?? null,
});

export interface MetricIdentity extends Identity {
  readonly scope: MetricRow["scope"];
  readonly scopeId: string;
  readonly date: string | null;
  readonly stepIndex: number | null;
  readonly variantKey: string | null;
}

export const toMetricRow = (
  identity: MetricIdentity,
  counts: MetricCounts
): MetricRow => ({
  ...counts,
  contentHash: null,
  date: identity.date,
  evidence: "exact",
  provider: identity.provider,
  schemaVersion: SCHEMA_VERSION,
  scope: identity.scope,
  scopeRef: makeRef(identity.provider, identity.workspaceId, identity.scopeId),
  stepIndex: identity.stepIndex,
  timezone: identity.date === null ? null : "UTC",
  variantKey: identity.variantKey,
  workspaceId: identity.workspaceId,
});
