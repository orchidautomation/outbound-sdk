// Reads and small lookups the people insights share: a listing with a cap
// that is always reported, campaigns by status, and a lead's display fields.

import { z } from "zod";

import { campaignStatusSchema } from "../../internal/entities.ts";
import type {
  Campaign,
  CampaignStatus,
  Lead,
} from "../../internal/entities.ts";
import type { ListAll } from "../../internal/outbound/api.ts";
import type { InsightContext } from "../define.ts";

/**
 * Reads at most `max` records. One more than `max` is asked for, so a cap
 * that falls in the middle of a page is still seen and reported.
 */
export const readCapped = async <Item>(
  context: InsightContext,
  open: (max: number) => ListAll<Item>,
  max: number,
  what: string
): Promise<Item[]> => {
  const items = await context.all(open(max + 1));

  if (items.length > max) {
    context.partial(`Stopped at ${max} ${what}; more exist.`);
  }

  return items.slice(0, max);
};

export const statusesField = z
  .array(campaignStatusSchema)
  .min(1)
  .default(["active"])
  .describe("Campaign statuses to consider, for example active or paused");

/**
 * Campaigns in the given statuses, up to `max`. Without a status filter on
 * the adapter the first `max` campaigns are read and filtered here.
 */
export const campaignsIn = async (
  context: InsightContext,
  statuses: readonly CampaignStatus[],
  max: number
): Promise<Campaign[]> => {
  const { outbound } = context;
  const wanted = [...new Set(statuses)];

  if (outbound.capabilities["campaigns.status"] === false) {
    const every = await readCapped(
      context,
      (cap) => outbound.campaigns.listAll({ max: cap }),
      max,
      "campaigns"
    );

    return every.filter((campaign) => wanted.includes(campaign.status));
  }

  const campaigns: Campaign[] = [];

  for (const status of wanted) {
    const room = max - campaigns.length;

    if (room <= 0) {
      context.partial(`Stopped at ${max} campaigns; more may exist.`);
      break;
    }

    // oxlint-disable-next-line no-await-in-loop -- one status at a time keeps the rate budget predictable.
    const found = await readCapped(
      context,
      (cap) => outbound.campaigns.listAll({ max: cap, status }),
      room,
      "campaigns"
    );

    campaigns.push(...found);
  }

  return campaigns;
};

/** The leads of one campaign, up to `max`. Needs `leads.byCampaign`. */
export const leadsOf = (
  context: InsightContext,
  campaign: string,
  max: number
): Promise<Lead[]> =>
  readCapped(
    context,
    (cap) => context.outbound.campaign(campaign).leads.listAll({ max: cap }),
    max,
    "leads of a campaign"
  );

/** First and last name joined, or `null` when the vendor has neither. */
export const nameOf = (lead: Lead): string | null => {
  const name = [lead.firstName, lead.lastName]
    .flatMap((part) => (part === null || part.trim() === "" ? [] : [part]))
    .join(" ");

  return name === "" ? null : name;
};

/** The part of an email address after the `@`, or `null`. */
export const domainOf = (email: string | null): string | null => {
  const domain = email?.split("@").at(-1) ?? "";

  return email === null || !email.includes("@") || domain === ""
    ? null
    : domain;
};

export const DEFAULT_POSITIVE_LABELS = [
  "Interested",
  "Meeting Booked",
  "Meeting Completed",
];

export const positiveLabelsField = z
  .array(z.string().min(1))
  .default(DEFAULT_POSITIVE_LABELS)
  .describe(
    "Vendor interest labels that count as interested, matched without regard to case"
  );

/** `null` when the lead has no label, so "not interested" is never guessed. */
export const isPositive = (
  label: string | null,
  labels: readonly string[]
): boolean | null =>
  label === null
    ? null
    : labels.some(
        (each) => each.trim().toLowerCase() === label.trim().toLowerCase()
      );

/** Whether the vendor says the lead replied: a status, a count or a time. */
export const hasReplied = (lead: Lead): boolean =>
  lead.status === "replied" ||
  (lead.engagement?.replies ?? 0) > 0 ||
  (lead.engagement?.lastRepliedAt ?? null) !== null;
