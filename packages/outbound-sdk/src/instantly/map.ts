// Instantly payloads -> normalized entities. Pure functions, no I/O.
// Field names follow the API V2 reference; see docs/research/instantly.md.

import type {
  Campaign,
  CampaignStatus,
  Lead,
  LeadStatus,
  Message,
  Reply,
  ReplyCategory,
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
  flag,
  isJsonObject,
  objects,
  stringMap,
  text,
  timestamp,
} from "../internal/json.ts";
import type { Json, JsonObject } from "../internal/json.ts";
import { recordBase, refTo } from "../internal/record.ts";
import type { Identity } from "../internal/record.ts";
import { stableId } from "../internal/sha256.ts";
import { normalizeBody } from "../internal/text.ts";

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

/** The Instantly status number for one of our statuses, when it has one. */
export const campaignStatusCode = (
  status: CampaignStatus
): number | undefined =>
  new Map<CampaignStatus, number>([
    ["active", 1],
    ["completed", 3],
    ["draft", 0],
    ["paused", 2],
  ]).get(status);

export const toCampaign = (identity: Identity, raw: JsonObject): Campaign => ({
  ...recordBase(identity, text(raw.id) ?? "", raw),
  channel: "email",
  createdAt: timestamp(raw.timestamp_created),
  name: text(raw.name) ?? "",
  status: CAMPAIGN_STATUS.get(count(raw.status) ?? Number.NaN) ?? "unknown",
  tags: [],
});

const DELAY_DAYS = new Map([
  ["days", 1],
  ["hours", 1 / 24],
  ["minutes", 1 / 1440],
]);

const delayDays = (step: JsonObject): number | null => {
  const delay = count(step.delay);
  const perUnit = DELAY_DAYS.get(text(step.delay_unit) ?? "days");

  return delay === null || perUnit === undefined ? null : delay * perUnit;
};

/** Variants are positional: Instantly gives them no ids. 0 is "A". */
export const variantKey = (index: number): string =>
  String.fromCodePoint(65 + index);

const toStep = (step: JsonObject, index: number): SequenceStep => ({
  action: text(step.type) ?? "email",
  branch: null,
  delayDays: delayDays(step),
  index,
  parentIndex: index === 0 ? null : index - 1,
  variants: objects(step.variants).map((variant, variantIndex) => {
    const subject = text(variant.subject);
    const body = text(variant.body);

    return {
      body,
      contentHash: stableId(subject, body),
      subject,
      variantKey: variantKey(variantIndex),
    };
  }),
});

/** A campaign's steps live inside the campaign object; there is no sequence endpoint. */
export const toSequence = (identity: Identity, raw: JsonObject): Sequence => {
  const id = text(raw.id) ?? "";
  const [first] = objects(raw.sequences);

  return {
    ...recordBase(identity, id, raw.sequences ?? null),
    campaignRef: refTo(identity, id) ?? "",
    kind: "main",
    name: null,
    steps: objects(first?.steps).map(toStep),
  };
};

const SENDER_STATUS = new Map<number, SenderStatus>([
  [-3, "error"],
  [-2, "error"],
  [-1, "disconnected"],
  [1, "active"],
  [2, "paused"],
  [3, "paused"],
]);

const fullName = (raw: JsonObject): string | null => {
  const name = [text(raw.first_name), text(raw.last_name)]
    .filter((part) => part !== null)
    .join(" ");

  return name === "" ? null : name;
};

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
    name: fullName(raw),
    status: SENDER_STATUS.get(count(raw.status) ?? Number.NaN) ?? "unknown",
    warmup:
      warmupStatus === null && count(raw.stat_warmup_score) === null
        ? null
        : {
            enabled: warmupStatus === null ? null : warmupStatus === 1,
            score: count(raw.stat_warmup_score),
          },
  };
};

// -3 is "Skipped", which has no equivalent here.
const LEAD_STATUS = new Map<number, LeadStatus>([
  [-2, "unsubscribed"],
  [-1, "bounced"],
  [1, "active"],
  [2, "paused"],
  [3, "completed"],
]);

export const toLead = (identity: Identity, raw: JsonObject): Lead => ({
  ...recordBase(identity, text(raw.id) ?? "", raw),
  campaignRef: refTo(identity, text(raw.campaign)),
  company: text(raw.company_name),
  createdAt: timestamp(raw.timestamp_created),
  custom: stringMap(raw.payload),
  email: emailAddress(raw.email),
  engagement: null,
  firstName: text(raw.first_name),
  interest: null,
  tags: [],
  lastName: text(raw.last_name),
  linkedinUrl: null,
  status: LEAD_STATUS.get(count(raw.status) ?? Number.NaN) ?? "unknown",
  title: text(raw.job_title),
});

/** `ue_type`: 1 sent from a campaign, 2 received, 3 sent by hand, 4 scheduled. */
export const SCHEDULED = 4;
const RECEIVED = 2;

const stepIndex = (value: Json | undefined): number | null => {
  const step = text(value);

  return step !== null && /^\d+$/u.test(step) && Number(step) >= 1
    ? Number(step) - 1
    : null;
};

const messageFields = (
  identity: Identity,
  raw: JsonObject,
  includeBody: boolean
) => {
  const body = field(raw.body, "html") ?? field(raw.body, "text");

  return {
    ...recordBase(identity, text(raw.id) ?? "", raw),
    ...normalizeBody(text(body), includeBody),
    campaignRef: refTo(identity, text(raw.campaign_id)),
    channel: "email" as const,
    leadRef: refTo(identity, text(raw.lead_id)),
    senderRef: refTo(identity, emailAddress(raw.eaccount)),
    sentAt: timestamp(raw.timestamp_email) ?? timestamp(raw.timestamp_created),
    stepIndex: stepIndex(raw.step),
    subject: text(raw.subject),
    threadId: text(raw.thread_id),
    variantKey: null,
  };
};

export const isScheduled = (raw: JsonObject): boolean =>
  count(raw.ue_type) === SCHEDULED;

export const toMessage = (
  identity: Identity,
  raw: JsonObject,
  includeBody: boolean
): Message => ({
  ...messageFields(identity, raw, includeBody),
  direction: count(raw.ue_type) === RECEIVED ? "in" : "out",
});

// The lead interest status values. Custom labels use other numbers and stay unknown.
const CATEGORY = new Map<number, ReplyCategory>([
  [-4, "negative"],
  [-3, "negative"],
  [-2, "negative"],
  [-1, "negative"],
  [0, "ooo"],
  [1, "positive"],
  [2, "positive"],
  [3, "positive"],
  [4, "positive"],
]);

/** The interest status numbers that mean one of our categories. */
export const interestCodes = (category: ReplyCategory): number[] =>
  [...CATEGORY.entries()].flatMap(([code, mapped]) =>
    mapped === category ? [code] : []
  );

const isAuto = (raw: JsonObject): boolean | null => {
  const value = raw.is_auto_reply;

  return flag(value) ?? (count(value) === null ? null : count(value) === 1);
};

export const toReply = (
  identity: Identity,
  raw: JsonObject,
  includeBody: boolean
): Reply => {
  const interest = count(raw.i_status);
  const category = interest === null ? undefined : CATEGORY.get(interest);

  return {
    ...messageFields(identity, raw, includeBody),
    category: category ?? "unknown",
    categorySource: category === undefined ? null : "vendor",
    direction: "in",
    isAuto: isAuto(raw),
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

/** `{ items, next_starting_after }`: the shape of every Instantly list. */
export const listEnvelope = (body: Json): ListEnvelope => ({
  items: objects(isJsonObject(body) ? body.items : body),
  next: text(field(body, "next_starting_after")) ?? undefined,
});
