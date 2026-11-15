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
import { OutboundError } from "../../internal/errors.ts";
import type { ListAll } from "../../internal/outbound/api.ts";
import { readCampaignsIn, readCapped as readUpTo } from "../capped.ts";
import type { Capped } from "../capped.ts";
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

/** Walks a listing up to `max` records, and says so in a note naming `input` when more exist. */
export const readCapped = async <Item>(
  context: InsightContext,
  walk: (max: number) => ListAll<Item>,
  max: number,
  what: string,
  input: string
): Promise<Item[]> => {
  const { items } = await readUpTo(context, walk, { input, max, what });

  return items;
};

/** The campaigns in the given statuses, up to `max_campaigns`. */
export const readCampaigns = async (
  context: InsightContext,
  statuses: readonly CampaignStatus[],
  max: number
): Promise<Campaign[]> => {
  const { items } = await readCampaignsIn(context, statuses, max);

  return items;
};

/** The senders attached to one campaign, up to `max`. */
export const readCampaignSenders = (
  context: InsightContext,
  campaign: Campaign,
  max: number,
  input: string
): Promise<Sender[]> =>
  readCapped(
    context,
    (cap) =>
      context.outbound.campaign(campaign.ref).senders.listAll({ max: cap }),
    max,
    `senders of campaign ${campaign.name}`,
    input
  );

/** Every sender of the workspace, up to `max_senders`, and whether more exist. */
export const readSenders = (
  context: InsightContext,
  max: number
): Promise<Capped<Sender>> =>
  readUpTo(context, (cap) => context.outbound.senders.listAll({ max: cap }), {
    input: "max_senders",
    max,
    what: "senders",
  });

/**
 * One sender's health, or `null` when the vendor no longer finds the sender,
 * for example a mailbox deleted mid-run. That sender is left out with a note
 * naming it, and the answer is marked incomplete. Any other error throws.
 */
export const readHealth = async (
  context: InsightContext,
  sender: Sender
): Promise<SenderHealth | null> => {
  try {
    return context.one(await context.outbound.sender(sender.ref).health());
  } catch (error) {
    if (!OutboundError.is(error) || error.code !== "NotFound") {
      throw error;
    }

    context.partial(
      `Left out ${sender.address ?? sender.ref}: the vendor no longer finds this sender.`
    );

    return null;
  }
};

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
