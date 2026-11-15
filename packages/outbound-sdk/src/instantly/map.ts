// Instantly payloads -> normalized entities. Pure functions, no I/O.
// Field names follow the API V2 reference; see docs/research/instantly.md.

import type {
  Campaign,
  CampaignStatus,
  MailProvider,
  Sender,
  SenderStatus,
  Sequence,
  SequenceStep,
  Workspace,
} from "../internal/entities.ts";
import {
  count,
  emailAddress,
  field,
  fullName,
  objects,
  text,
  timestamp,
} from "../internal/json.ts";
import type { Json, JsonObject } from "../internal/json.ts";
import { listIn } from "../internal/lists.ts";
import { recordBase, refTo } from "../internal/record.ts";
import type { Identity } from "../internal/record.ts";
import { toVariant, variantKey } from "../internal/sequence.ts";

// 4 is "Running Subsequences": the campaign is still sending. The negative
// values are Instantly pausing the campaign itself (account suspended,
// accounts unhealthy, bounce protect).
const CAMPAIGN_STATUS = new Map<number, CampaignStatus>([
  [-99, "paused"],
  [-2, "paused"],
  [-1, "paused"],
  [0, "draft"],
  [1, "active"],
  [2, "paused"],
  [3, "completed"],
  [4, "active"],
]);

/**
 * The status Instantly can filter for us. Active and paused each cover
 * several Instantly statuses, so they have no single number.
 */
export const campaignStatusCode = (
  status: CampaignStatus
): number | undefined =>
  new Map<CampaignStatus, number>([
    ["completed", 3],
    ["draft", 0],
  ]).get(status);

export const toCampaign = (
  identity: Identity,
  raw: JsonObject,
  tags: readonly string[] = []
): Campaign => ({
  ...recordBase(identity, text(raw.id) ?? "", raw),
  channel: "email",
  createdAt: timestamp(raw.timestamp_created),
  name: text(raw.name) ?? text(raw.id) ?? "",
  status: CAMPAIGN_STATUS.get(count(raw.status) ?? Number.NaN) ?? "unknown",
  tags: [...tags],
});

const DELAY_DAYS = new Map([
  ["days", 1],
  ["hours", 1 / 24],
  ["minutes", 1 / 1440],
]);

const days = (
  value: Json | undefined,
  unit: Json | undefined
): number | null => {
  const delay = count(value);
  const perUnit = DELAY_DAYS.get(text(unit) ?? "days");

  return delay === null || perUnit === undefined ? null : delay * perUnit;
};

// `delay` is the wait before the NEXT email, so a step waits for the delay
// of the step before it. Only a subsequence's first step has a wait of its
// own (`pre_delay`); a campaign's first step goes out at once.
const waitBefore = (
  step: JsonObject,
  previous: JsonObject | undefined,
  subsequence: boolean
): number | null => {
  if (previous !== undefined) {
    return days(previous.delay, previous.delay_unit);
  }

  return subsequence ? days(step.pre_delay, step.pre_delay_unit) : 0;
};

/** Only the first entry of `sequences` is used, as the reference says. */
const toSteps = (
  sequences: Json | undefined,
  subsequence: boolean
): SequenceStep[] => {
  const steps = objects(objects(sequences)[0]?.steps);

  return steps.map((step, index) => ({
    action: text(step.type) ?? "email",
    branch: null,
    delayDays: waitBefore(step, steps[index - 1], subsequence),
    index,
    parentIndex: index === 0 ? null : index - 1,
    // Variants are positional: Instantly gives them no ids.
    variants: objects(step.variants).map((variant, variantIndex) =>
      toVariant(
        text(variant.subject),
        text(variant.body),
        variantKey(variantIndex)
      )
    ),
  }));
};

/** A campaign's steps live inside the campaign object; there is no sequence endpoint. */
export const toSequence = (identity: Identity, raw: JsonObject): Sequence => {
  const id = text(raw.id) ?? "";

  return {
    ...recordBase(identity, id, raw.sequences ?? null),
    campaignRef: refTo(identity, id) ?? "",
    kind: "main",
    name: null,
    steps: toSteps(raw.sequences, false),
  };
};

/** `GET /subsequences`: a follow-up path a lead enters when its conditions are met. */
export const toSubsequence = (
  identity: Identity,
  raw: JsonObject,
  campaignId: string
): Sequence => ({
  ...recordBase(identity, text(raw.id) ?? "", raw),
  campaignRef: refTo(identity, text(raw.parent_campaign) ?? campaignId) ?? "",
  kind: "subsequence",
  name: text(raw.name),
  steps: toSteps(raw.sequences, true),
});

const SENDER_STATUS = new Map<number, SenderStatus>([
  [-3, "error"],
  [-2, "error"],
  [-1, "disconnected"],
  [1, "active"],
  [2, "paused"],
  [3, "paused"],
]);

// 4 is AWS and 8 and 11 are Instantly's own AirMail mailboxes.
const MAIL_PROVIDER = new Map<number, MailProvider>([
  [1, "smtp"],
  [2, "google"],
  [3, "microsoft"],
  [4, "other"],
  [8, "other"],
  [11, "other"],
]);

/** A mailbox. Instantly keys accounts by email address, not by an id. */
export const toSender = (identity: Identity, raw: JsonObject): Sender => {
  const address = emailAddress(raw.email);
  const warmupStatus = count(raw.warmup_status);

  return {
    ...recordBase(identity, address ?? "", raw),
    address,
    dailyLimit: count(raw.daily_limit),
    kind: "mailbox",
    linkedinUrl: null,
    mailProvider:
      MAIL_PROVIDER.get(count(raw.provider_code) ?? Number.NaN) ?? null,
    name: fullName(raw.first_name, raw.last_name),
    status: SENDER_STATUS.get(count(raw.status) ?? Number.NaN) ?? "unknown",
    // Present only when the request asked for `include_tags`.
    tags: objects(raw.tags).flatMap((tag) => text(tag.label) ?? []),
    warmup:
      warmupStatus === null && count(raw.stat_warmup_score) === null
        ? null
        : {
            enabled: warmupStatus === null ? null : warmupStatus === 1,
            score: count(raw.stat_warmup_score),
          },
  };
};

export const toWorkspace = (
  identity: Identity,
  raw: JsonObject
): Workspace => ({
  ...recordBase(identity, text(raw.id) ?? identity.workspaceId, raw),
  name: text(raw.name) ?? identity.workspaceId,
});

export interface ListEnvelope {
  readonly items: JsonObject[];
  readonly next: string | undefined;
}

/**
 * `{ items, next_starting_after }`: the shape of every Instantly list, with
 * `items` required. Any other answer, a bare array included, is a `Provider`
 * error naming `path`.
 */
export const listEnvelope = (
  body: Json,
  provider: string,
  path: string
): ListEnvelope => ({
  items: objects(
    listIn(body, { key: "items", path, provider, vendor: "Instantly" })
  ),
  next: text(field(body, "next_starting_after")) ?? undefined,
});
