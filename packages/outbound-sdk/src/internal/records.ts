// The records the SDK returns, as the package exports them: each record's
// schema and type, the coverage that says which of its fields an adapter
// fills, and the option that maps custom fields onto a lead. The entry point
// re-exports this file whole, so a record added here is public.

export {
  campaignSchema,
  campaignStatusSchema,
  channelSchema,
  eventDataSchema,
  eventTypeSchema,
  evidenceSchema,
  leadProgressSchema,
  leadSchema,
  leadStatusSchema,
  mailProviderSchema,
  meetingStatusSchema,
  messageSchema,
  metricRowSchema,
  metricScopeSchema,
  outboundEventSchema,
  recipientMailProviderSchema,
  replyCategorySchema,
  replyRuleSchema,
  replySchema,
  SCHEMA_VERSION,
  senderSchema,
  senderStatusSchema,
  sequenceSchema,
  workspaceSchema,
} from "./entities.ts";

export type {
  Campaign,
  CampaignStatus,
  Channel,
  EventData,
  EventType,
  Evidence,
  Lead,
  LeadEngagement,
  LeadProgress,
  LeadStatus,
  MailProvider,
  MeetingStatus,
  Message,
  MetricRow,
  MetricScope,
  OutboundEvent,
  RecipientMailProvider,
  Reply,
  ReplyCategory,
  Sender,
  SenderStatus,
  Sequence,
  SequenceStep,
  SequenceVariant,
  Workspace,
} from "./entities.ts";

export {
  blockEntrySchema,
  campaignProgressSchema,
  campaignSettingsSchema,
  leadListSchema,
  placementTestSchema,
  senderHealthSchema,
  tagSchema,
  webhookSubscriptionSchema,
} from "./entities-account.ts";

export type {
  BlockEntry,
  CampaignProgress,
  CampaignSettings,
  Entity,
  LeadList,
  PlacementTest,
  SenderHealth,
  SendingWindow,
  Tag,
  WebhookSubscription,
} from "./entities-account.ts";

export { resolveFields } from "./fields.ts";

export type {
  FieldCoverage,
  FieldDeclaration,
  FieldGrade,
  RecordName,
} from "./fields.ts";

export type { LeadFieldMap } from "./lead-fields.ts";
