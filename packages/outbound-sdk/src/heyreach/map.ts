// HeyReach payloads -> normalized entities. Pure functions, no I/O.
// Field names follow the public API reference; see docs/research/heyreach.md.

import type {
  Campaign,
  CampaignStatus,
  Lead,
  LeadStatus,
  Sender,
  SenderStatus,
} from "../internal/entities.ts";
import {
  count,
  emailAddress,
  field,
  flag,
  isJsonObject,
  objects,
  text,
  timestamp,
} from "../internal/json.ts";
import type { Json, JsonObject } from "../internal/json.ts";
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
  name: text(raw.name) ?? "",
  status: CAMPAIGN_STATUS.get(text(raw.status) ?? "") ?? "unknown",
  tags: [],
});

const fullName = (raw: JsonObject): string | null => {
  const name = [text(raw.firstName), text(raw.lastName)]
    .filter((part) => part !== null)
    .join(" ");

  return name === "" ? null : name;
};

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
  name: fullName(raw),
  status: senderStatus(raw),
  warmup: null,
});

const LEAD_STATUS = new Map<string, LeadStatus>([
  ["Finished", "completed"],
  ["InSequence", "active"],
  ["Paused", "paused"],
  ["Pending", "active"],
]);

const leadStatus = (raw: JsonObject): LeadStatus =>
  text(raw.leadMessageStatus) === "MessageReply"
    ? "replied"
    : (LEAD_STATUS.get(text(raw.leadCampaignStatus) ?? "") ?? "unknown");

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
  custom: {},
  email:
    emailAddress(field(profile, "emailAddress")) ??
    emailAddress(field(profile, "enrichedEmailAddress")),
  firstName: text(field(profile, "firstName")),
  lastName: text(field(profile, "lastName")),
  linkedinUrl: text(field(profile, "profileUrl")),
  title: text(field(profile, "position")),
});

/** `POST /lead/GetLead`: a profile with no campaign and no status. */
export const toLead = (identity: Identity, raw: JsonObject): Lead => ({
  ...profileFields(identity, raw, raw),
  campaignRef: null,
  createdAt: null,
  status: "unknown",
});

/** `POST /campaign/GetLeadsFromCampaign`: the profile is nested in the row. */
export const toCampaignLead = (
  identity: Identity,
  raw: JsonObject,
  campaignId: string
): Lead => ({
  ...profileFields(identity, raw.linkedInUserProfile, raw),
  campaignRef: refTo(identity, campaignId),
  createdAt: timestamp(raw.creationTime),
  status: leadStatus(raw),
});

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
