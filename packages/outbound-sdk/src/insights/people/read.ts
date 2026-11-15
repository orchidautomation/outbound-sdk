// Reads and small lookups the people insights share: a listing with a cap
// that is always reported, campaigns by status, and a lead's display fields.

import { z } from "zod";

import { campaignStatusSchema } from "../../internal/entities.ts";
import type {
  Campaign,
  CampaignStatus,
  Lead,
} from "../../internal/entities.ts";
import type { BulkResult, ListAll } from "../../internal/outbound/api.ts";
import type { InsightContext } from "../define.ts";

/** Reads at most `max` records, and says so in a note when more exist. */
export const readCapped = <Item>(
  context: InsightContext,
  open: (max: number) => ListAll<Item>,
  max: number,
  what: string
): Promise<Item[]> => context.all(open(max), `${max} ${what}`);

/**
 * Reads records by ref in one batch and maps them by ref. A record that
 * cannot be read is left out with a note ending in `effect`. Every record of
 * a batch carries the whole batch's cost, so the cost is counted once.
 */
export const readByRef = async <Item>(
  context: InsightContext,
  refs: readonly string[],
  read: (refs: readonly string[]) => Promise<BulkResult<Item>>,
  what: string,
  effect: string
): Promise<Map<string, Item>> => {
  if (refs.length === 0) {
    return new Map();
  }

  const found = await read(refs);

  if (found.errors.length > 0) {
    context.note(
      `${found.errors.length} ${what} could not be read, so ${found.errors.length === 1 ? "its" : "their"} ${effect}.`
    );
  }

  const [costliest] = found.results.toSorted(
    (left, right) => right.value.meta.requests - left.value.meta.requests
  );

  if (costliest !== undefined) {
    context.one(costliest.value);
  }

  return new Map(found.results.map(({ id, value }) => [id, value]));
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

    // oxlint-disable-next-line no-await-in-loop -- each status reads only the room the earlier ones left under the cap.
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
  lead.replied === true ||
  (lead.engagement?.replies ?? 0) > 0 ||
  (lead.engagement?.lastRepliedAt ?? null) !== null;

const COUNTS = "no per-lead open, click or reply counts";

/**
 * Says which records lack open, click and reply counts, and only when some
 * do. One tool: the adapter's own declaration decides. A combined instance
 * lacks `leads.engagement` as soon as one tool does, although the others
 * still fill the counts, so there each tool is judged by the records read
 * and the ones with no counts on any lead are named. `effect` finishes the
 * sentence, for example `those are null`.
 */
export const noteEngagement = (
  context: InsightContext,
  leads: readonly Lead[],
  effect: string
): void => {
  const { outbound } = context;

  if (outbound.capabilities["leads.engagement"]) {
    return;
  }

  if (leads.every((lead) => lead.provider === outbound.provider)) {
    context.note(`This tool reports ${COUNTS}, so ${effect}.`);

    return;
  }

  const reporting = new Set(
    leads.flatMap((lead) => (lead.engagement === null ? [] : [lead.provider]))
  );

  const lacking = [...new Set(leads.map((lead) => lead.provider))]
    .filter((provider) => !reporting.has(provider))
    .toSorted();

  if (lacking.length > 0) {
    context.note(
      `${lacking.join(", ")} ${lacking.length === 1 ? "reports" : "report"} ${COUNTS}, so ${effect} for ${lacking.length === 1 ? "its" : "their"} records. Records from the other tools carry what their vendor reports.`
    );
  }
};
