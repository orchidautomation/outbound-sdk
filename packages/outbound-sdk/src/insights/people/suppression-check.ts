// suppression_check: leads in campaigns who are on the block list.

import { z } from "zod";

import { mapConcurrent } from "../../internal/concurrency.ts";
import type { BlockEntry } from "../../internal/entities-account.ts";
import type { Campaign, Lead } from "../../internal/entities.ts";
import { profileSlug } from "../../internal/url.ts";
import { defineInsight } from "../define.ts";
import { tally } from "../stats.ts";
import {
  campaignsIn,
  domainOf,
  leadsOf,
  readCapped,
  statusesField,
} from "./read.ts";

const input = z.object({
  max_block_entries: z
    .number()
    .int()
    .min(1)
    .max(100_000)
    .default(2000)
    .describe(
      "The most block list entries to read. A vendor request returns about 50 to 100."
    ),
  max_campaigns: z
    .number()
    .int()
    .min(1)
    .max(200)
    .default(20)
    .describe(
      "The most campaigns to check. Each costs one request per page of its leads."
    ),
  max_leads_per_campaign: z
    .number()
    .int()
    .min(1)
    .max(20_000)
    .default(500)
    .describe("The most leads to read from each campaign"),
  statuses: statusesField,
});

export type SuppressionMatch = "domain" | "email" | "linkedin";

export interface SuppressionViolation {
  readonly lead: string;
  readonly email: string | null;
  readonly linkedinUrl: string | null;
  readonly leadStatus: string;
  readonly campaign: string;
  readonly campaignName: string;
  /** The block list entry's ref. */
  readonly entry: string;
  readonly entryValue: string;
  /** `email` for the exact address, `domain` for its domain, `linkedin` for the profile. */
  readonly matchedBy: SuppressionMatch;
  /** `false` when the entry is on another tool's block list than the campaign's. */
  readonly sameTool: boolean;
  readonly finding: string;
}

export interface SuppressionCampaign {
  readonly campaign: string;
  readonly campaignName: string;
  readonly leadsRead: number;
  readonly violations: number;
}

export interface SuppressionCheck {
  /** Leads still `active` first, then by campaign and lead. */
  readonly violations: readonly SuppressionViolation[];
  /** Every campaign checked, most violations first. */
  readonly byCampaign: readonly SuppressionCampaign[];
  readonly totals: {
    readonly violations: number;
    readonly byMatch: {
      readonly email: number;
      readonly domain: number;
      readonly linkedin: number;
    };
    readonly campaignsRead: number;
    readonly leadsRead: number;
    readonly blockEntriesRead: number;
    /** Entries of a kind that cannot be matched to a lead: a company name or the vendor's `other`. */
    readonly blockEntriesNotChecked: number;
  };
}

interface Blocked {
  readonly email: Map<string, BlockEntry>;
  readonly domain: Map<string, BlockEntry>;
  readonly linkedin: Map<string, BlockEntry>;
  readonly notChecked: number;
}

/** A profile entry is a URL on some tools and the bare slug on others. */
const slugOfEntry = (value: string): string =>
  profileSlug(value) ??
  value
    .trim()
    .replaceAll(/^\/+|\/+$/gu, "")
    .toLowerCase();

const indexEntries = (entries: readonly BlockEntry[]): Blocked => {
  const blocked: Blocked = {
    domain: new Map(),
    email: new Map(),
    linkedin: new Map(),
    notChecked: entries.filter(
      (entry) => entry.kind === "company" || entry.kind === "other"
    ).length,
  };

  for (const entry of entries) {
    if (entry.kind === "email") {
      blocked.email.set(entry.value.trim().toLowerCase(), entry);
    } else if (entry.kind === "domain") {
      blocked.domain.set(
        entry.value.trim().toLowerCase().replace(/^@/u, ""),
        entry
      );
    } else if (entry.kind === "linkedin") {
      blocked.linkedin.set(slugOfEntry(entry.value), entry);
    }
  }

  return blocked;
};

interface Hit {
  readonly entry: BlockEntry;
  readonly matchedBy: SuppressionMatch;
}

/** The most specific match: the exact address, then the profile, then the domain. */
const matchLead = (lead: Lead, blocked: Blocked): Hit | null => {
  const slug = profileSlug(lead.linkedinUrl);

  const candidates: [SuppressionMatch, BlockEntry | undefined][] = [
    ["email", blocked.email.get(lead.email ?? "")],
    ["linkedin", blocked.linkedin.get(slug ?? "")],
    ["domain", blocked.domain.get(domainOf(lead.email) ?? "")],
  ];

  const hits = candidates.flatMap(([matchedBy, entry]) =>
    entry === undefined ? [] : [{ entry, matchedBy }]
  );

  return hits[0] ?? null;
};

const toViolation = (
  lead: Lead,
  campaign: Campaign,
  { entry, matchedBy }: Hit
): SuppressionViolation => ({
  campaign: campaign.ref,
  campaignName: campaign.name,
  email: lead.email,
  entry: entry.ref,
  entryValue: entry.value,
  finding: `${lead.email ?? lead.linkedinUrl ?? lead.ref} is in "${campaign.name}" but the block list holds the ${matchedBy} ${entry.value}.`,
  lead: lead.ref,
  leadStatus: lead.status,
  linkedinUrl: lead.linkedinUrl,
  matchedBy,
  sameTool:
    entry.provider === lead.provider && entry.workspaceId === lead.workspaceId,
});

const activeFirst = (
  left: SuppressionViolation,
  right: SuppressionViolation
): number =>
  Number(right.leadStatus === "active") -
    Number(left.leadStatus === "active") ||
  left.campaign.localeCompare(right.campaign) ||
  left.lead.localeCompare(right.lead);

export const suppressionCheck = defineInsight({
  description:
    "Leads sitting in campaigns although they are on the block list. Reads the block list, then the leads of each campaign in the given statuses (active by default), and matches a lead by exact email address, by email domain against domain entries, and by LinkedIn profile against profile entries. Returns each violation with the lead, the campaign, the entry and how it matched, counts per campaign, and how many block entries were read. On several tools an entry on one tool's list is also matched against the other tools' leads and marked sameTool false. Costs one request per page of block entries plus one per page of each campaign's leads.",
  inputSchema: input,
  key: "suppressionCheck",
  name: "suppression_check",
  needs: ["blocklist", "leads.byCampaign"],
  next: "Use person_summary with a violating lead's email address to see what they were already sent.",
  run: async (context, values) => {
    const entries = await readCapped(
      context,
      (cap) => context.outbound.blocklist.listAll({ max: cap }),
      values.max_block_entries,
      "block list entries"
    );

    const blocked = indexEntries(entries);

    const campaigns = await campaignsIn(
      context,
      values.statuses,
      values.max_campaigns
    );

    const violations: SuppressionViolation[] = [];
    const byCampaign: SuppressionCampaign[] = [];

    const read = await mapConcurrent(campaigns, async (campaign) => ({
      campaign,
      leads: await leadsOf(
        context,
        campaign.ref,
        values.max_leads_per_campaign
      ),
    }));

    for (const { campaign, leads } of read) {
      const found = leads.flatMap((lead) => {
        const hit = matchLead(lead, blocked);

        return hit === null ? [] : [toViolation(lead, campaign, hit)];
      });

      violations.push(...found);
      byCampaign.push({
        campaign: campaign.ref,
        campaignName: campaign.name,
        leadsRead: leads.length,
        violations: found.length,
      });
    }

    const matches = tally(violations.map((each) => each.matchedBy));

    const answer: SuppressionCheck = {
      byCampaign: byCampaign.toSorted(
        (left, right) =>
          right.violations - left.violations ||
          left.campaign.localeCompare(right.campaign)
      ),
      totals: {
        blockEntriesNotChecked: blocked.notChecked,
        blockEntriesRead: entries.length,
        byMatch: {
          domain: matches.get("domain") ?? 0,
          email: matches.get("email") ?? 0,
          linkedin: matches.get("linkedin") ?? 0,
        },
        campaignsRead: campaigns.length,
        leadsRead: byCampaign.reduce((sum, each) => sum + each.leadsRead, 0),
        violations: violations.length,
      },
      violations: violations.toSorted(activeFirst),
    };

    return answer;
  },
});
