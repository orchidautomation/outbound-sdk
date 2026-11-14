// Seed shapes for the in-memory adapter, and their conversion to entities.
// Seeds are short on purpose: only an id is required and everything else has
// a default, so a test or demo states only what it cares about.

import { SCHEMA_VERSION } from "../internal/entities.ts";
import type {
  Campaign,
  CampaignStatus,
  Channel,
  Lead,
  LeadStatus,
  Message,
  MetricRow,
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

export interface MemoryVariant {
  readonly key?: string;
  readonly subject?: string;
  readonly body?: string;
}

export interface MemoryStep {
  readonly action?: string;
  readonly delayDays?: number;
  readonly variants: readonly MemoryVariant[];
}

export interface MemoryCampaign {
  readonly id: string;
  readonly name?: string;
  readonly status?: CampaignStatus;
  readonly channel?: Channel;
  readonly createdAt?: string;
  readonly tags?: readonly string[];
  readonly steps?: readonly MemoryStep[];
}

export interface MemorySender {
  readonly id: string;
  readonly address?: string;
  readonly linkedinUrl?: string;
  readonly name?: string;
  readonly status?: SenderStatus;
  readonly dailyLimit?: number;
  readonly warmup?: { readonly enabled: boolean; readonly score?: number };
  /** The campaigns this sender is attached to. */
  readonly campaignIds?: readonly string[];
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
  readonly status?: LeadStatus;
  readonly custom?: Readonly<Record<string, string>>;
  readonly createdAt?: string;
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
  readonly subject?: string;
  readonly body?: string;
  /** Inbound only. */
  readonly category?: ReplyCategory;
  /** Inbound only. */
  readonly isAuto?: boolean;
}

export interface MemoryStats {
  /** `YYYY-MM-DD`. */
  readonly date: string;
  readonly campaignId: string;
  /** Set for a per-sender row. */
  readonly senderId?: string;
  /** Set for a per-step row. */
  readonly stepIndex?: number;
  readonly counts: Partial<MetricCounts>;
}

export interface MemoryData {
  readonly campaigns?: readonly MemoryCampaign[];
  readonly senders?: readonly MemorySender[];
  readonly leads?: readonly MemoryLead[];
  readonly messages?: readonly MemoryMessage[];
  readonly stats?: readonly MemoryStats[];
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

export const toSequence = (
  identity: Identity,
  seed: MemoryCampaign
): Sequence => ({
  ...base(identity, seed.id),
  campaignRef: makeRef(identity.provider, identity.workspaceId, seed.id),
  steps: (seed.steps ?? []).map((step, index) => ({
    action: step.action ?? (seed.channel === "linkedin" ? "message" : "email"),
    delayDays: step.delayDays ?? null,
    index,
    variants: step.variants.map((variant, variantIndex) => ({
      body: variant.body ?? null,
      contentHash: stableId(variant.subject, variant.body),
      subject: variant.subject ?? null,
      variantKey: variant.key ?? String.fromCodePoint(65 + variantIndex),
    })),
  })),
});

export const toSender = (identity: Identity, seed: MemorySender): Sender => ({
  ...base(identity, seed.id),
  address: seed.address?.trim().toLowerCase() ?? null,
  dailyLimit: seed.dailyLimit ?? null,
  kind: seed.linkedinUrl === undefined ? "mailbox" : "linkedin",
  linkedinUrl: seed.linkedinUrl ?? null,
  name: seed.name ?? null,
  status: seed.status ?? "active",
  warmup:
    seed.warmup === undefined
      ? null
      : { enabled: seed.warmup.enabled, score: seed.warmup.score ?? null },
});

export const toLead = (identity: Identity, seed: MemoryLead): Lead => ({
  ...base(identity, seed.id),
  campaignRef: refOrNull(identity, seed.campaignId),
  company: seed.company ?? null,
  createdAt: seed.createdAt ?? null,
  custom: { ...seed.custom },
  email: seed.email?.trim().toLowerCase() ?? null,
  firstName: seed.firstName ?? null,
  lastName: seed.lastName ?? null,
  linkedinUrl: seed.linkedinUrl ?? null,
  status: seed.status ?? "active",
  title: seed.title ?? null,
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
  threadId: null,
  variantKey: seed.variantKey ?? null,
});

export const toMessage = (
  identity: Identity,
  seed: MemoryMessage,
  channel: Channel,
  includeBody: boolean
): Message => ({
  ...messageFields(identity, seed, channel, includeBody),
  direction: seed.direction,
});

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
});

export interface MetricIdentity extends Identity {
  readonly scope: MetricRow["scope"];
  readonly scopeId: string;
  readonly date: string | null;
  readonly stepIndex: number | null;
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
  variantKey: null,
  workspaceId: identity.workspaceId,
});
