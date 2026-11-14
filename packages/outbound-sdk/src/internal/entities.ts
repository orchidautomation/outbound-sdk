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

/** The fields every entity carries. */
export const baseFields = {
  provider: z.string().min(1),
  raw: z.json(),
  ref: z.string().min(1),
  schemaVersion: z.literal(SCHEMA_VERSION),
  sourceId: z.string().min(1),
  workspaceId: z.string().min(1),
};

const base = baseFields;

export const count = z.number().nonnegative().nullable();
export const isoDateTime = z.iso.datetime({ offset: true }).nullable();

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
  /** The vendor's name for it, or its id when the vendor gave none. Never empty. */
  name: z.string().min(1),
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
  /**
   * The outcome of the parent step's condition that leads here, in the
   * vendor's words, for example `accepted`. `null` on a straight path.
   */
  branch: z.string().nullable(),
  delayDays: z.number().nonnegative().nullable(),
  index: z.number().int().nonnegative(),
  /** The step that runs before this one. `null` for the first step. */
  parentIndex: z.number().int().nonnegative().nullable(),
  variants: z.array(sequenceVariantSchema),
});

export type SequenceStep = z.infer<typeof sequenceStepSchema>;

export const sequenceSchema = z.object({
  ...base,
  campaignRef: z.string(),
  /** `main` for the campaign's own steps, `subsequence` for a follow-up path. */
  kind: z.enum(["main", "subsequence"]),
  /** A subsequence's name. `null` for the main sequence. */
  name: z.string().nullable(),
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

export const mailProviderSchema = z.enum([
  "google",
  "microsoft",
  "other",
  "smtp",
]);

export type MailProvider = z.infer<typeof mailProviderSchema>;

export const senderSchema = z.object({
  ...base,
  /** Lowercased mailbox address. `null` for a LinkedIn seat. */
  address: z.string().nullable(),
  dailyLimit: count,
  kind: z.enum(["linkedin", "mailbox"]),
  linkedinUrl: z.string().nullable(),
  /** Who hosts the mailbox. `null` for a LinkedIn seat and when the vendor does not say. */
  mailProvider: mailProviderSchema.nullable(),
  name: z.string().nullable(),
  status: senderStatusSchema,
  /** The names of the tags on the sender. */
  tags: z.array(z.string()),
  warmup: z
    .object({
      enabled: z.boolean().nullable(),
      score: z.number().nullable(),
    })
    .nullable(),
});

export type Sender = z.infer<typeof senderSchema>;

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

/** What a lead did with the campaign's messages, as the vendor counts it. */
export const leadEngagementSchema = z.object({
  clicks: count,
  lastContactedAt: isoDateTime,
  lastOpenedAt: isoDateTime,
  lastRepliedAt: isoDateTime,
  opens: count,
  replies: count,
  /** The step the lead replied to, counted from 0. `null` when the vendor does not say. */
  repliedStepIndex: z.number().int().nonnegative().nullable(),
  /** The last step sent to the lead, counted from 0. */
  stepIndex: z.number().int().nonnegative().nullable(),
});

export type LeadEngagement = z.infer<typeof leadEngagementSchema>;

export const leadSchema = z.object({
  ...base,
  campaignRef: z.string().nullable(),
  company: z.string().nullable(),
  /** The company's LinkedIn page. */
  companyLinkedinUrl: z.string().nullable(),
  createdAt: isoDateTime,
  /** The lead's custom fields as the vendor stores them. */
  custom: z.record(z.string(), z.string()),
  /** Lowercased and trimmed. */
  email: z.string().nullable(),
  /** `null` when the vendor reports no per-lead counts on this read. */
  engagement: leadEngagementSchema.nullable(),
  firstName: z.string().nullable(),
  /** The vendor's own label for how interested the lead is, for example `Meeting Booked`. */
  interest: z.string().nullable(),
  /**
   * What `interest` means, in the categories a reply uses. `null` when the
   * lead has no label or the vendor does not say what the label means.
   */
  interestCategory: replyCategorySchema.nullable(),
  lastName: z.string().nullable(),
  linkedinUrl: z.string().nullable(),
  /** Where the lead is, in the vendor's own words. */
  location: z.string().nullable(),
  phone: z.string().nullable(),
  status: leadStatusSchema,
  tags: z.array(z.string()),
  title: z.string().nullable(),
  /** The company's website or domain, as the vendor stores it. */
  website: z.string().nullable(),
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

export const replySchema = z.object({
  ...messageFields,
  category: replyCategorySchema,
  /**
   * Who decided the category: `vendor` when the vendor labelled this reply,
   * `lead` when it is the vendor's label for the lead who sent it, `rule` for
   * a fixed rule. `null` when the category is `unknown`. Never a model.
   */
  categorySource: z.enum(["lead", "rule", "vendor"]).nullable(),
  direction: z.literal("in"),
  /** `true` for an auto-reply, `null` when the vendor does not say. */
  isAuto: z.boolean().nullable(),
  /** `true` while the reply, or the thread it is in, is unread in the vendor's inbox. */
  unread: z.boolean().nullable(),
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
  /** Unique clicks: leads who clicked at least once. */
  clicked: count,
  /** Every click, repeats included. */
  clickedTotal: count,
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
  /**
   * The timezone the row's day boundaries are in: a daily row's `date`, or the
   * ends of a dated total. `null` when the vendor does not say, and for a
   * lifetime total. A vendor's "day" is not always UTC.
   */
  timezone: z.string().nullable(),
  unsubscribed: count,
  variantKey: z.string().nullable(),
  workspaceId: z.string().min(1),
});

export type MetricRow = z.infer<typeof metricRowSchema>;

export const workspaceSchema = z.object({
  ...base,
  name: z.string().min(1),
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
