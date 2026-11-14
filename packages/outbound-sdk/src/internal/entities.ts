// The normalized data model. Each entity is defined once as a Zod schema and
// its type is inferred from the schema. Adapters only map onto these.
//
// Rules that hold for every entity:
// - `ref` is `provider:workspaceId:sourceId`, so two tools or two clients can
//   never be confused.
// - A value the vendor does not report is `null`, never `0` or `""`.
// - `raw` holds the vendor's original payload.

import { z } from "zod";

/** Bumped only for a breaking change to the shapes below. */
export const SCHEMA_VERSION = 1 as const;

const base = {
  provider: z.string().min(1),
  raw: z.json(),
  ref: z.string().min(1),
  schemaVersion: z.literal(SCHEMA_VERSION),
  sourceId: z.string().min(1),
  workspaceId: z.string().min(1),
};

const count = z.number().nonnegative().nullable();
const isoDateTime = z.iso.datetime({ offset: true }).nullable();

export const channelSchema = z.enum(["email", "linkedin"]);

export type Channel = z.infer<typeof channelSchema>;

export const campaignStatusSchema = z.enum([
  "active",
  "archived",
  "completed",
  "draft",
  "paused",
  "unknown",
]);

export type CampaignStatus = z.infer<typeof campaignStatusSchema>;

export const campaignSchema = z.object({
  ...base,
  channel: channelSchema,
  createdAt: isoDateTime,
  name: z.string(),
  status: campaignStatusSchema,
  tags: z.array(z.string()),
});

export type Campaign = z.infer<typeof campaignSchema>;

export const sequenceVariantSchema = z.object({
  /** Template text only, never a rendered message. */
  body: z.string().nullable(),
  /** A hash of subject and body, so stats can tell old copy from new. */
  contentHash: z.string(),
  subject: z.string().nullable(),
  variantKey: z.string(),
});

export type SequenceVariant = z.infer<typeof sequenceVariantSchema>;

export const sequenceStepSchema = z.object({
  /** What the step does: `email`, or a LinkedIn action such as `connection_request`. */
  action: z.string(),
  delayDays: z.number().nonnegative().nullable(),
  index: z.number().int().nonnegative(),
  variants: z.array(sequenceVariantSchema),
});

export type SequenceStep = z.infer<typeof sequenceStepSchema>;

export const sequenceSchema = z.object({
  ...base,
  campaignRef: z.string(),
  steps: z.array(sequenceStepSchema),
});

export type Sequence = z.infer<typeof sequenceSchema>;

export const senderStatusSchema = z.enum([
  "active",
  "disconnected",
  "error",
  "paused",
  "unknown",
]);

export type SenderStatus = z.infer<typeof senderStatusSchema>;

export const senderSchema = z.object({
  ...base,
  /** Lowercased mailbox address. `null` for a LinkedIn seat. */
  address: z.string().nullable(),
  dailyLimit: count,
  kind: z.enum(["linkedin", "mailbox"]),
  linkedinUrl: z.string().nullable(),
  name: z.string().nullable(),
  status: senderStatusSchema,
  warmup: z
    .object({
      enabled: z.boolean().nullable(),
      score: z.number().nullable(),
    })
    .nullable(),
});

export type Sender = z.infer<typeof senderSchema>;

export const leadStatusSchema = z.enum([
  "active",
  "bounced",
  "completed",
  "paused",
  "replied",
  "unknown",
  "unsubscribed",
]);

export type LeadStatus = z.infer<typeof leadStatusSchema>;

export const leadSchema = z.object({
  ...base,
  campaignRef: z.string().nullable(),
  company: z.string().nullable(),
  createdAt: isoDateTime,
  /** The lead's custom fields as the vendor stores them. */
  custom: z.record(z.string(), z.string()),
  /** Lowercased and trimmed. */
  email: z.string().nullable(),
  firstName: z.string().nullable(),
  lastName: z.string().nullable(),
  linkedinUrl: z.string().nullable(),
  status: leadStatusSchema,
  title: z.string().nullable(),
});

export type Lead = z.infer<typeof leadSchema>;

const messageFields = {
  ...base,
  /** `null` unless the call asked for bodies and the vendor returned one. */
  bodyHtml: z.string().nullable(),
  /** Plain text with quoted history removed. */
  bodyText: z.string().nullable(),
  campaignRef: z.string().nullable(),
  channel: channelSchema,
  leadRef: z.string().nullable(),
  senderRef: z.string().nullable(),
  sentAt: isoDateTime,
  stepIndex: z.number().int().nonnegative().nullable(),
  subject: z.string().nullable(),
  threadId: z.string().nullable(),
  variantKey: z.string().nullable(),
};

export const messageSchema = z.object({
  ...messageFields,
  direction: z.enum(["in", "out"]),
});

export type Message = z.infer<typeof messageSchema>;

export const replyCategorySchema = z.enum([
  "bounce",
  "negative",
  "neutral",
  "ooo",
  "positive",
  "unknown",
  "unsubscribe",
]);

export type ReplyCategory = z.infer<typeof replyCategorySchema>;

export const replySchema = z.object({
  ...messageFields,
  category: replyCategorySchema,
  /** Who decided the category. `null` when it is `unknown`. Never a model. */
  categorySource: z.enum(["rule", "vendor"]).nullable(),
  direction: z.literal("in"),
  /** `true` for an auto-reply, `null` when the vendor does not say. */
  isAuto: z.boolean().nullable(),
});

export type Reply = z.infer<typeof replySchema>;

export const metricScopeSchema = z.enum([
  "campaign",
  "sender",
  "step",
  "workspace",
]);

export type MetricScope = z.infer<typeof metricScopeSchema>;

export const evidenceSchema = z.enum(["derived", "exact", "sampled"]);

export type Evidence = z.infer<typeof evidenceSchema>;

/**
 * Counts only. Rates are computed from these in `metrics.ts`, so every
 * adapter and plugin agrees on what a reply rate is.
 */
export const metricRowSchema = z.object({
  bounced: count,
  clicked: count,
  /** LinkedIn only. */
  connectionsAccepted: count,
  /** LinkedIn only. */
  connectionsSent: count,
  /** Unique leads contacted. */
  contacted: count,
  contentHash: z.string().nullable(),
  /** `YYYY-MM-DD` in `timezone`. `null` for a total over the range. */
  date: z.iso.date().nullable(),
  delivered: count,
  evidence: evidenceSchema,
  /** LinkedIn only. */
  inmailsSent: count,
  /** Unique opens. `null` when open tracking is off. */
  opened: count,
  openedTotal: count,
  positive: count,
  provider: z.string().min(1),
  /** Replies from people. Auto-replies are counted in `repliedAuto`. */
  replied: count,
  repliedAuto: count,
  schemaVersion: z.literal(SCHEMA_VERSION),
  scope: metricScopeSchema,
  scopeRef: z.string(),
  /** Messages sent. Email sends, or LinkedIn messages. */
  sent: count,
  stepIndex: z.number().int().nonnegative().nullable(),
  /** The vendor's timezone for daily rows. A vendor's "day" is not always UTC. */
  timezone: z.string().nullable(),
  unsubscribed: count,
  variantKey: z.string().nullable(),
  workspaceId: z.string().min(1),
});

export type MetricRow = z.infer<typeof metricRowSchema>;

export const workspaceSchema = z.object({
  ...base,
  name: z.string(),
});

export type Workspace = z.infer<typeof workspaceSchema>;

export const eventTypeSchema = z.enum([
  "campaign.status_changed",
  "lead.status_changed",
  "lead.unsubscribed",
  "linkedin.connection_accepted",
  "linkedin.connection_sent",
  "linkedin.message_received",
  "linkedin.message_sent",
  "meeting.booked",
  "message.bounced",
  "message.clicked",
  "message.opened",
  "message.sent",
  "reply.categorized",
  "reply.received",
  "sender.status_changed",
  "unknown",
]);

export type EventType = z.infer<typeof eventTypeSchema>;

/** Every webhook and every sync diff becomes this one shape. */
export const outboundEventSchema = z.object({
  campaignRef: z.string().nullable(),
  /** The type-specific normalized payload. */
  data: z.record(z.string(), z.json()),
  /** Stable across redelivery, so handling an event twice is a no-op. */
  id: z.string().min(1),
  leadRef: z.string().nullable(),
  messageRef: z.string().nullable(),
  /** The vendor's time for the event. */
  occurredAt: isoDateTime,
  provider: z.string().min(1),
  /** The original body, always kept. */
  raw: z.json(),
  schemaVersion: z.literal(SCHEMA_VERSION),
  senderRef: z.string().nullable(),
  type: eventTypeSchema,
  workspaceId: z.string().min(1),
});

export type OutboundEvent = z.infer<typeof outboundEventSchema>;

/** Any record a list or get call returns. */
export type Entity =
  | Campaign
  | Lead
  | Message
  | Reply
  | Sender
  | Sequence
  | Workspace;
