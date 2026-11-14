// The account-level records: a campaign's settings, a sender's health, lead
// lists, block list entries, tags and webhook subscriptions. They follow the
// same rules as entities.ts.

import { z } from "zod";

import { baseFields, count, isoDateTime } from "./entities.ts";
import type {
  Campaign,
  Lead,
  Message,
  Reply,
  Sender,
  Sequence,
  Workspace,
} from "./entities.ts";

const clock = z
  .string()
  .regex(/^\d{2}:\d{2}$/u)
  .nullable();

const flag = z.boolean().nullable();

/** One window in which a campaign may send. */
export const sendingWindowSchema = z.object({
  /** Days of the week the window is open, 0 for Sunday to 6 for Saturday. */
  days: z.array(z.number().int().min(0).max(6)),
  /** `HH:MM` in `timezone`. */
  from: clock,
  name: z.string().nullable(),
  /** An IANA name where the vendor gives one, otherwise the vendor's own label. */
  timezone: z.string().nullable(),
  /** `HH:MM` in `timezone`. */
  to: clock,
});

export type SendingWindow = z.infer<typeof sendingWindowSchema>;

/** How a campaign is set up to send. `sourceId` is the campaign's id. */
export const campaignSettingsSchema = z.object({
  ...baseFields,
  campaignRef: z.string(),
  /** The most messages (or LinkedIn actions) the campaign sends per day. */
  dailyLimit: count,
  /** The most new leads the campaign contacts per day. */
  dailyNewLeads: count,
  endDate: z.iso.date().nullable(),
  /** The shortest wait between two sends, in minutes. */
  gapMinutes: z.number().nonnegative().nullable(),
  /** `true` when emails are sent without HTML. */
  plainText: flag,
  schedule: z.array(sendingWindowSchema),
  startDate: z.iso.date().nullable(),
  /** `true` when a lead who sends an automatic reply gets no more steps. */
  stopOnAutoReply: flag,
  /** `true` when a lead who replies gets no more steps. */
  stopOnReply: flag,
  tracking: z.object({ clicks: flag, opens: flag }),
});

export type CampaignSettings = z.infer<typeof campaignSettingsSchema>;

/** What the vendor knows about a sender's deliverability. `sourceId` is the sender's id. */
export const senderHealthSchema = z.object({
  ...baseFields,
  /** `true` when the domain or address is on a block list the vendor checks. */
  blacklisted: flag,
  /** When the vendor last checked. */
  checkedAt: isoDateTime,
  /** `true` when the vendor can sign in to the mailbox or the LinkedIn seat. */
  connected: flag,
  /** Whether each DNS record is present and valid. */
  dns: z.object({ dkim: flag, dmarc: flag, mx: flag, spf: flag }),
  /** The mailbox's domain, lowercased. `null` for a LinkedIn seat. */
  domain: z.string().nullable(),
  /** Problems in the vendor's own words. */
  issues: z.array(z.string()),
  senderRef: z.string(),
  /** Warmup traffic over the vendor's reporting window. `null` when there is none. */
  warmup: z
    .object({
      inbox: count,
      received: count,
      score: z.number().nullable(),
      sent: count,
      spam: count,
    })
    .nullable(),
});

export type SenderHealth = z.infer<typeof senderHealthSchema>;

/** A saved list of leads or companies that campaigns draw from. */
export const leadListSchema = z.object({
  ...baseFields,
  createdAt: isoDateTime,
  kind: z.enum(["companies", "leads"]),
  /** The vendor's name for it, or its id when the vendor gave none. Never empty. */
  name: z.string().min(1),
  /** How many records the list holds. */
  size: count,
});

export type LeadList = z.infer<typeof leadListSchema>;

/** One address, domain or profile the account never contacts. */
export const blockEntrySchema = z.object({
  ...baseFields,
  createdAt: isoDateTime,
  kind: z.enum(["company", "domain", "email", "linkedin", "other"]),
  /** Lowercased for emails and domains. */
  value: z.string(),
});

export type BlockEntry = z.infer<typeof blockEntrySchema>;

export const tagSchema = z.object({
  ...baseFields,
  description: z.string().nullable(),
  name: z.string().min(1),
});

export type Tag = z.infer<typeof tagSchema>;

/** A webhook registered with the vendor. */
export const webhookSubscriptionSchema = z.object({
  ...baseFields,
  active: flag,
  /** The campaigns the webhook is limited to. Empty for every campaign. */
  campaignRefs: z.array(z.string()),
  createdAt: isoDateTime,
  /** Event names in the vendor's own words. */
  events: z.array(z.string()),
  name: z.string().nullable(),
  /** Where the vendor posts. It can hold a secret in its path or query. */
  url: z.string(),
});

export type WebhookSubscription = z.infer<typeof webhookSubscriptionSchema>;

/** Any record a list or get call returns. */
export type Entity =
  | BlockEntry
  | Campaign
  | CampaignSettings
  | Lead
  | LeadList
  | Message
  | Reply
  | Sender
  | SenderHealth
  | Sequence
  | Tag
  | WebhookSubscription
  | Workspace;
