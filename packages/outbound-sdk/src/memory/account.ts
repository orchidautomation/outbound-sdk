// The in-memory adapter's account-level records: settings, health, lists,
// block list, tags and webhooks.

import type {
  BlockEntry,
  CampaignSettings,
  LeadList,
  SenderHealth,
  SendingWindow,
  Tag,
  WebhookSubscription,
} from "../internal/entities-account.ts";
import type { EventType } from "../internal/entities.ts";
import { recordBase, refsTo } from "../internal/record.ts";
import type { Identity } from "../internal/record.ts";
import { makeRef } from "../internal/ref.ts";

export interface MemorySettings {
  readonly schedule?: readonly Partial<SendingWindow>[];
  readonly dailyLimit?: number;
  readonly dailyNewLeads?: number;
  readonly gapMinutes?: number;
  readonly startDate?: string;
  readonly endDate?: string;
  readonly trackOpens?: boolean;
  readonly trackClicks?: boolean;
  readonly stopOnReply?: boolean;
  readonly stopOnAutoReply?: boolean;
  readonly plainText?: boolean;
}

export interface MemoryHealth {
  readonly spf?: boolean;
  readonly dkim?: boolean;
  readonly dmarc?: boolean;
  readonly mx?: boolean;
  readonly connected?: boolean;
  readonly blacklisted?: boolean;
  readonly issues?: readonly string[];
  readonly checkedAt?: string;
  readonly warmup?: {
    readonly sent?: number;
    readonly received?: number;
    readonly inbox?: number;
    readonly spam?: number;
    readonly score?: number;
  };
}

export interface MemoryList {
  readonly id: string;
  readonly name?: string;
  readonly kind?: LeadList["kind"];
  readonly createdAt?: string;
}

export interface MemoryBlockEntry {
  readonly id: string;
  readonly value: string;
  readonly kind?: BlockEntry["kind"];
  readonly createdAt?: string;
}

export interface MemoryTag {
  readonly id: string;
  readonly name?: string;
  readonly description?: string;
}

export interface MemoryWebhook {
  readonly id: string;
  readonly url: string;
  readonly name?: string;
  readonly events?: readonly string[];
  readonly eventTypes?: readonly EventType[];
  readonly active?: boolean;
  readonly campaignId?: string;
  readonly createdAt?: string;
}

const base = (identity: Identity, sourceId: string) =>
  recordBase(identity, sourceId, null);

export const toSettings = (
  identity: Identity,
  campaignId: string,
  seed: MemorySettings
): CampaignSettings => ({
  ...base(identity, campaignId),
  campaignRef: makeRef(identity.provider, identity.workspaceId, campaignId),
  dailyLimit: seed.dailyLimit ?? null,
  dailyNewLeads: seed.dailyNewLeads ?? null,
  endDate: seed.endDate ?? null,
  gapMinutes: seed.gapMinutes ?? null,
  plainText: seed.plainText ?? null,
  schedule: (seed.schedule ?? []).map((window) => ({
    days: [...(window.days ?? [])],
    from: window.from ?? null,
    name: window.name ?? null,
    timezone: window.timezone ?? null,
    to: window.to ?? null,
  })),
  startDate: seed.startDate ?? null,
  stopOnAutoReply: seed.stopOnAutoReply ?? null,
  stopOnReply: seed.stopOnReply ?? null,
  tracking: {
    clicks: seed.trackClicks ?? null,
    opens: seed.trackOpens ?? null,
  },
});

export const toHealth = (
  identity: Identity,
  sender: { readonly id: string; readonly address?: string | undefined },
  seed: MemoryHealth
): SenderHealth => ({
  ...base(identity, sender.id),
  blacklisted: seed.blacklisted ?? null,
  checkedAt: seed.checkedAt ?? null,
  connected: seed.connected ?? null,
  dns: {
    dkim: seed.dkim ?? null,
    dmarc: seed.dmarc ?? null,
    mx: seed.mx ?? null,
    spf: seed.spf ?? null,
  },
  domain: sender.address?.split("@")[1]?.trim().toLowerCase() ?? null,
  issues: [...(seed.issues ?? [])],
  senderRef: makeRef(identity.provider, identity.workspaceId, sender.id),
  warmup:
    seed.warmup === undefined
      ? null
      : {
          inbox: seed.warmup.inbox ?? null,
          received: seed.warmup.received ?? null,
          score: seed.warmup.score ?? null,
          sent: seed.warmup.sent ?? null,
          spam: seed.warmup.spam ?? null,
        },
});

export const toList = (
  identity: Identity,
  seed: MemoryList,
  size: number
): LeadList => ({
  ...base(identity, seed.id),
  createdAt: seed.createdAt ?? null,
  kind: seed.kind ?? "leads",
  name: seed.name ?? seed.id,
  size,
});

export const toBlockEntry = (
  identity: Identity,
  seed: MemoryBlockEntry
): BlockEntry => ({
  ...base(identity, seed.id),
  createdAt: seed.createdAt ?? null,
  kind: seed.kind ?? (seed.value.includes("@") ? "email" : "domain"),
  value: seed.value.trim().toLowerCase(),
});

export const toTag = (identity: Identity, seed: MemoryTag): Tag => ({
  ...base(identity, seed.id),
  description: seed.description ?? null,
  name: seed.name ?? seed.id,
});

export const toWebhook = (
  identity: Identity,
  seed: MemoryWebhook
): WebhookSubscription => ({
  ...base(identity, seed.id),
  active: seed.active ?? true,
  campaignRefs: refsTo(identity, [seed.campaignId]),
  createdAt: seed.createdAt ?? null,
  eventTypes: [...(seed.eventTypes ?? [])],
  events: [...(seed.events ?? [])],
  name: seed.name ?? null,
  url: seed.url,
});
