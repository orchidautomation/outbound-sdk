// HeyReach account-level payloads -> normalized records. Pure functions, no
// I/O. Field names follow the public API reference and one live workspace
// read on 2026-11-14; see docs/research/heyreach.md.

import type {
  BlockEntry,
  CampaignProgress,
  LeadList,
  SenderHealth,
  WebhookSubscription,
} from "../internal/entities-account.ts";
import {
  count,
  emailAddress,
  field,
  flag,
  list,
  text,
  timestamp,
} from "../internal/json.ts";
import type { JsonObject } from "../internal/json.ts";
import { eventTypesOf, recordBase, refTo, refsTo } from "../internal/record.ts";
import type { Identity } from "../internal/record.ts";
import { EVENT_TYPES } from "./webhooks.ts";

/**
 * `GET /campaign/GetById`: `progressStats` counts the campaign's leads by how
 * far they got. `totalUsersExcluded` counts the leads an exclusion filter or
 * exclusion list kept out, which are skipped.
 */
export const toCampaignProgress = (
  identity: Identity,
  campaignId: string,
  raw: JsonObject
): CampaignProgress => {
  const stats = raw.progressStats;

  return {
    ...recordBase(identity, campaignId, raw),
    // HeyReach has no bounce and no block list for a campaign's leads.
    blocked: null,
    campaignRef: refTo(identity, campaignId) ?? "",
    completed: count(field(stats, "totalUsersFinished")),
    failed: count(field(stats, "totalUsersFailed")),
    inProgress: count(field(stats, "totalUsersInProgress")),
    leads: count(field(stats, "totalUsers")),
    notStarted: count(field(stats, "totalUsersPending")),
    skipped: count(field(stats, "totalUsersExcluded")),
    stopped: count(field(stats, "totalUsersManuallyStopped")),
  };
};

/** `POST /list/GetAll`: `listType` is `USER_LIST` or `COMPANY_LIST`. */
export const toLeadList = (identity: Identity, raw: JsonObject): LeadList => ({
  ...recordBase(identity, text(raw.id) ?? "", raw),
  createdAt: timestamp(raw.creationTime),
  kind: text(raw.listType) === "COMPANY_LIST" ? "companies" : "leads",
  name: text(raw.name) ?? text(raw.id) ?? "",
  size: count(raw.totalItemsCount),
});

// A blacklisted lead is entered as a profile URL, an email or a name alone.
// The most exact one HeyReach holds is the entry's value.
const blockedLead = (
  raw: JsonObject
): Pick<BlockEntry, "kind" | "value"> | null => {
  const profileUrl = text(raw.profileUrl);

  if (profileUrl !== null) {
    return { kind: "linkedin", value: profileUrl };
  }

  const email = emailAddress(raw.email);

  if (email !== null) {
    return { kind: "email", value: email };
  }

  const name = text(raw.fullName);

  return name === null ? null : { kind: "other", value: name };
};

/**
 * `POST /blacklist/GetLeads`. Leads and companies are numbered separately,
 * so the id says which blacklist the entry is on. An entry with no URL, email
 * or name is skipped.
 */
export const toBlockedLead = (
  identity: Identity,
  raw: JsonObject
): BlockEntry[] => {
  const entry = blockedLead(raw);
  const id = text(raw.id);

  return entry === null || id === null
    ? []
    : [
        {
          ...recordBase(identity, `lead-${id}`, raw),
          ...entry,
          createdAt: timestamp(raw.creationTime),
        },
      ];
};

/** `POST /blacklist/GetCompanies`: a company name, or its LinkedIn page. */
export const toBlockedCompany = (
  identity: Identity,
  raw: JsonObject
): BlockEntry[] => {
  const value = text(raw.companyName) ?? text(raw.linkedInUrl);
  const id = text(raw.id);

  return value === null || id === null
    ? []
    : [
        {
          ...recordBase(identity, `company-${id}`, raw),
          createdAt: timestamp(raw.creationTime),
          kind: "company",
          value,
        },
      ];
};

/** The campaigns a webhook is limited to. Empty means every campaign. */
export const webhookCampaigns = (raw: JsonObject): string[] =>
  list(raw.campaignIds).flatMap((id) => {
    const campaign = text(id);

    return campaign === null ? [] : [campaign];
  });

/**
 * `POST /webhooks/GetAllWebhooks`. A webhook listens to one event type. It can
 * be limited to several campaigns; an empty `campaignRefs` is every campaign.
 */
export const toWebhook = (
  identity: Identity,
  raw: JsonObject
): WebhookSubscription => {
  const campaigns = webhookCampaigns(raw);
  const event = text(raw.eventType);

  return {
    ...recordBase(identity, text(raw.id) ?? "", raw),
    active: flag(raw.isActive),
    campaignRefs: refsTo(identity, campaigns),
    createdAt: null,
    // The list names an event in upper case; a payload names it in lower.
    eventTypes: eventTypesOf(
      event === null ? [] : [event.toLowerCase()],
      EVENT_TYPES
    ),
    events: event === null ? [] : [event],
    name: text(raw.webhookName),
    url: text(raw.webhookUrl) ?? "",
  };
};

// Only these two values are known: `Disconnected` from the docs and
// `Connected` from a live account. Any other status is left as unknown.
const CONNECTED = new Map([
  ["Connected", true],
  ["Disconnected", false],
]);

/**
 * `GET /li_account/GetAccountStatus/{accountId}`. A LinkedIn seat has no
 * domain, DNS records, block lists or warmup, so those are null.
 */
export const toSenderHealth = (
  identity: Identity,
  senderId: string,
  raw: JsonObject
): SenderHealth => {
  const reason = text(raw.failureReason);

  return {
    ...recordBase(identity, senderId, raw),
    blacklisted: null,
    checkedAt: null,
    connected: CONNECTED.get(text(raw.status) ?? "") ?? null,
    dns: { dkim: null, dmarc: null, mx: null, spf: null },
    domain: null,
    issues: reason === null ? [] : [reason],
    senderRef: refTo(identity, senderId) ?? "",
    warmup: null,
  };
};
