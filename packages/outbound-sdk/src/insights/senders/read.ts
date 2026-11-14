// What the senders insights share: capped listings, campaigns by status, and
// the checks made on one sender's health record.

import { z } from "zod";

import type { SenderHealth } from "../../internal/entities-account.ts";
import { campaignStatusSchema } from "../../internal/entities.ts";
import type {
  Campaign,
  CampaignStatus,
  Sender,
} from "../../internal/entities.ts";
import type { ListAll } from "../../internal/outbound/api.ts";
import type { InsightContext } from "../define.ts";

export const statusesInput = z
  .array(campaignStatusSchema)
  .min(1)
  .default(["active"])
  .describe(
    "Campaign statuses to look at: active, paused, draft, completed, archived or unknown"
  );

export const dayInput = (what: string) =>
  z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/u)
    .optional()
    .describe(
      `${what}, as YYYY-MM-DD. Leave out for the vendor's whole history.`
    );

/** Walks a listing up to `max` records, and says so in a note when more exist. */
export const readCapped = <Item>(
  context: InsightContext,
  walk: (max: number) => ListAll<Item>,
  max: number,
  what: string
): Promise<Item[]> => context.all(walk(max), `${max} ${what}`);

/** The campaigns in the given statuses, up to `max`. */
export const readCampaigns = async (
  context: InsightContext,
  statuses: readonly CampaignStatus[],
  max: number
): Promise<Campaign[]> => {
  const { outbound } = context;

  if (outbound.capabilities["campaigns.status"] === false) {
    // The vendor cannot filter by status, so the cap counts every campaign read.
    const every = await readCapped(
      context,
      (cap) => outbound.campaigns.listAll({ max: cap }),
      max,
      "campaigns"
    );

    return every.filter((campaign) => statuses.includes(campaign.status));
  }

  const found: Campaign[] = [];

  for (const status of new Set(statuses)) {
    const room = max - found.length;

    if (room <= 0) {
      context.partial(
        `The cap of ${max} campaigns was reached before ${status} campaigns were read.`
      );
      break;
    }

    found.push(
      // oxlint-disable-next-line no-await-in-loop -- each status reads only the room the earlier ones left under the cap.
      ...(await readCapped(
        context,
        (cap) => outbound.campaigns.listAll({ max: cap, status }),
        room,
        "campaigns"
      ))
    );
  }

  return found;
};

/** The senders attached to one campaign, up to `max`. */
export const readCampaignSenders = (
  context: InsightContext,
  campaign: Campaign,
  max: number
): Promise<Sender[]> =>
  readCapped(
    context,
    (cap) =>
      context.outbound.campaign(campaign.ref).senders.listAll({ max: cap }),
    max,
    `senders of campaign ${campaign.name}`
  );

/** The part after the `@`, lowercased. `null` for a LinkedIn seat. */
export const domainOf = (address: string | null): string | null => {
  const domain = address?.split("@")[1]?.trim().toLowerCase() ?? "";

  return domain === "" ? null : domain;
};

export const DNS_RECORDS = ["spf", "dkim", "dmarc", "mx"] as const;

export type DnsRecord = (typeof DNS_RECORDS)[number];

/** The DNS records the vendor reports as missing or invalid. */
export const failingDns = (health: SenderHealth): DnsRecord[] =>
  DNS_RECORDS.filter((record) => health.dns[record] === false);

/** The DNS records the vendor says nothing about. */
export const unknownDns = (health: SenderHealth): DnsRecord[] =>
  DNS_RECORDS.filter((record) => health.dns[record] === null);

export interface WarmupSpam {
  /** Warmup emails counted: those sent, or inbox plus spam when sent is not reported. */
  readonly sent: number;
  readonly spam: number;
}

/** Warmup emails that landed in spam and the number they are counted against, or `null` when either is unknown. */
export const warmupSpam = (health: SenderHealth): WarmupSpam | null => {
  const { warmup } = health;

  if (warmup === null || warmup.spam === null) {
    return null;
  }

  const sent =
    warmup.sent ?? (warmup.inbox === null ? null : warmup.inbox + warmup.spam);

  return sent === null ? null : { sent, spam: warmup.spam };
};

/** Today in UTC, plus or minus whole days, as `YYYY-MM-DD`. */
export const dayFrom = (now: number, offsetDays: number): string =>
  new Date(now + offsetDays * 86_400_000).toISOString().slice(0, 10);
