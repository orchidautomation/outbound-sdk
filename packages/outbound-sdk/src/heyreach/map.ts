// HeyReach payloads -> normalized entities. Pure functions, no I/O.
// Field names follow the public API reference; see docs/research/heyreach.md.

import type {
  Campaign,
  CampaignStatus,
  Lead,
  LeadProgress,
  ReplyCategory,
  Sender,
  SenderStatus,
} from "../internal/entities.ts";
import {
  count,
  emailAddress,
  field,
  flag,
  fullName,
  isJsonObject,
  list,
  objects,
  text,
  timestamp,
} from "../internal/json.ts";
import type { Json, JsonObject } from "../internal/json.ts";
import { leadStanding } from "../internal/lead-status.ts";
import { recordBase, refTo } from "../internal/record.ts";
import type { Identity } from "../internal/record.ts";

// The docs name the statuses without defining them. FAILED has no equivalent
// and stays unknown.
const CAMPAIGN_STATUS = new Map<string, CampaignStatus>([
  ["CANCELED", "completed"],
  ["DRAFT", "draft"],
  ["FINISHED", "completed"],
  ["IN_PROGRESS", "active"],
  ["PAUSED", "paused"],
  ["SCHEDULED", "draft"],
  ["STARTING", "active"],
]);

/** The HeyReach statuses behind one of ours, for the `statuses` filter. */
export const vendorStatuses = (status: CampaignStatus): string[] =>
  status === "unknown"
    ? ["FAILED"]
    : [...CAMPAIGN_STATUS.entries()].flatMap(([vendor, mapped]) =>
        mapped === status ? [vendor] : []
      );

export const toCampaign = (identity: Identity, raw: JsonObject): Campaign => ({
  ...recordBase(identity, text(raw.id) ?? "", raw),
  channel: "linkedin",
  createdAt: timestamp(raw.creationTime),
  name: text(raw.name) ?? text(raw.id) ?? "",
  status: CAMPAIGN_STATUS.get(text(raw.status) ?? "") ?? "unknown",
  tags: [],
});

// A LinkedIn account has no status enum, only two booleans the docs leave
// undefined. An invalid login is the clearer signal, so it wins.
const senderStatus = (raw: JsonObject): SenderStatus => {
  if (flag(raw.authIsValid) === false) {
    return "disconnected";
  }

  const active = flag(raw.isActive);

  if (active === null) {
    return "unknown";
  }

  return active ? "active" : "paused";
};

/** A LinkedIn account. Its limits (`connectioRequestLimit` and so on) stay in raw. */
export const toSender = (identity: Identity, raw: JsonObject): Sender => ({
  ...recordBase(identity, text(raw.id) ?? "", raw),
  // `emailAddress` is the account's login, not an address mail is sent from.
  address: null,
  dailyLimit: null,
  kind: "linkedin",
  linkedinUrl: text(raw.profileUrl),
  mailProvider: null,
  name: fullName(raw.firstName, raw.lastName),
  status: senderStatus(raw),
  // HeyReach has no tags on a LinkedIn account.
  tags: [],
  warmup: null,
});

const LEAD_PROGRESS = new Map<string, LeadProgress>([
  ["Finished", "completed"],
  ["InSequence", "active"],
  ["Paused", "paused"],
  ["Pending", "active"],
]);

// Excluded and PendingOrExcludedToBeCalculated, which only
// GetCampaignsForLead reports, have no equivalent and stay unknown.
const campaignProgress = (value: Json | undefined): LeadProgress =>
  LEAD_PROGRESS.get(text(value) ?? "") ?? "unknown";

// LinkedIn has no bounce and no unsubscribe. A campaign's lead row says
// whether the lead replied (`leadMessageStatus`); no other lead shape does.
const standing = (progress: LeadProgress, messageStatus?: Json | undefined) => {
  const said = text(messageStatus);

  return leadStanding(progress, {
    bounced: null,
    replied: said === null ? null : said === "MessageReply",
    unsubscribed: null,
  });
};

/** A lead's manual tags: `tags` is an array of names. */
export const tagNames = (value: Json | undefined): string[] =>
  list(value).flatMap((tag) => {
    const name = text(tag);

    return name === null ? [] : [name];
  });

// `autoTags` is HeyReach's classification of the lead's first campaign reply
// (Interested, Not Interested, Generic). A lead keeps one per campaign, so the
// newest is the lead's current label.
const interest = (profile: Json | undefined): string | null => {
  const [newest] = objects(field(profile, "autoTags")).toSorted((left, right) =>
    (timestamp(right.creationTime) ?? "").localeCompare(
      timestamp(left.creationTime) ?? ""
    )
  );

  return text(newest?.name);
};

// The three auto-tags HeyReach's help center names. The API reference does
// not list the strings it returns, so any other name means nothing here.
const AUTO_TAG = new Map<string, ReplyCategory>([
  ["generic", "neutral"],
  ["interested", "positive"],
  ["not interested", "negative"],
]);

/** What a profile's newest auto-tag means, or `null`. */
export const interestCategory = (
  profile: Json | undefined
): ReplyCategory | null =>
  AUTO_TAG.get(interest(profile)?.toLowerCase() ?? "") ?? null;

// `customFields` is an array of `{ name, value }` pairs.
const customFields = (profile: Json | undefined): Record<string, string> =>
  Object.fromEntries(
    objects(field(profile, "customFields")).flatMap((pair) => {
      const name = text(pair.name);
      const value = text(pair.value);

      return name === null || value === null ? [] : [[name, value] as const];
    })
  );

// The profile URL is the id: GetLead looks a lead up by it, and it is the one
// key every lead shape carries. The member id (`linkedin_id`) stays in raw.
const profileFields = (
  identity: Identity,
  profile: Json | undefined,
  raw: JsonObject
) => ({
  ...recordBase(
    identity,
    text(field(profile, "profileUrl")) ??
      text(field(profile, "linkedin_id")) ??
      "",
    raw
  ),
  company: text(field(profile, "companyName")),
  // `companyUrl` is the company's LinkedIn page, not its website.
  companyLinkedinUrl: text(field(profile, "companyUrl")),
  custom: customFields(profile),
  email:
    emailAddress(field(profile, "emailAddress")) ??
    emailAddress(field(profile, "enrichedEmailAddress")) ??
    emailAddress(field(profile, "customEmailAddress")),
  // HeyReach reports no per-lead open, click or reply counts.
  engagement: null,
  firstName: text(field(profile, "firstName")),
  interest: interest(profile),
  interestCategory: interestCategory(profile),
  lastName: text(field(profile, "lastName")),
  tags: tagNames(field(profile, "tags")),
  linkedinUrl: text(field(profile, "profileUrl")),
  location: text(field(profile, "location")),
  // HeyReach profiles carry no phone number and no company website.
  phone: null,
  title: text(field(profile, "position")),
  website: null,
});

/**
 * `POST /lead/GetLead` and a row of `POST /list/GetLeadsFromList`: a profile
 * with no campaign and no status. GetLead carries no tags, so they are read
 * from `POST /lead/GetTags` and passed in.
 */
export const toLead = (
  identity: Identity,
  raw: JsonObject,
  tags?: Json | undefined
): Lead => {
  const lead = profileFields(identity, raw, raw);

  return {
    ...lead,
    ...standing("unknown"),
    campaignRef: null,
    createdAt: null,
    tags: tags === undefined ? lead.tags : tagNames(tags),
  };
};

/** `POST /campaign/GetLeadsFromCampaign`: the profile is nested in the row. */
export const toCampaignLead = (
  identity: Identity,
  raw: JsonObject,
  campaignId: string
): Lead => ({
  ...profileFields(identity, raw.linkedInUserProfile, raw),
  ...standing(
    campaignProgress(raw.leadCampaignStatus),
    raw.leadMessageStatus ?? null
  ),
  campaignRef: refTo(identity, campaignId),
  createdAt: timestamp(raw.creationTime),
});

/** Every address a `POST /lead/GetLead` profile carries, lowercased. */
export const profileEmails = (profile: JsonObject): string[] =>
  [
    profile.emailAddress,
    profile.enrichedEmailAddress,
    profile.customEmailAddress,
    ...list(profile.emailEnrichments),
  ].flatMap((value) => emailAddress(value) ?? []);

/**
 * A `POST /lead/GetLead` profile beside one row of
 * `POST /campaign/GetCampaignsForLead`, or beside `null` for a person who is
 * in no campaign. The row's `creationTime` is the campaign's, so the lead has
 * none. `email` is the address the lead was looked up by, which the profile
 * may hold in any of its email fields.
 */
export const toLookupLead = (
  identity: Identity,
  profile: JsonObject,
  campaign: JsonObject | null,
  email?: string | undefined
): Lead => {
  const raw: JsonObject = { campaign, lead: profile };
  const lead = profileFields(identity, profile, raw);

  // One record per campaign, all with the lead's own id: the profile URL.
  // The core tells looked-up records apart by their campaign.
  return {
    ...lead,
    ...standing(campaignProgress(campaign?.leadStatus)),
    campaignRef: refTo(identity, text(campaign?.campaignId)),
    createdAt: null,
    email: email ?? lead.email,
  };
};

export interface ListEnvelope {
  readonly items: JsonObject[];
  /** The offset of the next page, when there is one. */
  readonly next: number | undefined;
}

/** `{ totalCount, items }`: there is no next marker, so it is computed. */
export const listEnvelope = (body: Json, offset: number): ListEnvelope => {
  const items = objects(isJsonObject(body) ? body.items : undefined);
  const total = count(field(body, "totalCount"));
  const end = offset + items.length;

  return {
    items,
    next: items.length > 0 && total !== null && end < total ? end : undefined,
  };
};
