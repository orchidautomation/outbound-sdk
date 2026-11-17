// suppression_check: leads in campaigns who are on the block list.

import { z } from "zod";

import { mapConcurrent } from "../../internal/concurrency.ts";
import type { BlockEntry } from "../../internal/entities-account.ts";
import { leadStatusSchema } from "../../internal/entities.ts";
import type { Campaign, Lead, LeadStatus } from "../../internal/entities.ts";
import { plural } from "../../internal/numbers.ts";
import { profileSlug } from "../../internal/url.ts";
import { readCampaignsIn } from "../capped.ts";
import { defineInsight, maskingOf } from "../define.ts";
import type { InsightContext } from "../define.ts";
import { tally } from "../stats.ts";
import { wasCutShort } from "../tracked-reads.ts";
import { campaignGaps, gapsSentence } from "./coverage.ts";
import type { CampaignsChecked, Gap } from "./coverage.ts";
import { domainOf, readCappedFlag, statusesField } from "./read.ts";

/** The lead statuses still being sent to, or yet to start, by default. */
const SENDABLE: readonly [LeadStatus, ...LeadStatus[]] = [
  "active",
  "paused",
  "unknown",
];

const input = z.object({
  lead_statuses: z
    .array(leadStatusSchema)
    .min(1)
    .default([...SENDABLE])
    .describe(
      "Only a matching lead in one of these states is a violation: active, paused, unknown (not yet started, or the tool does not say), completed, skipped (the tool decided never to send), replied, bounced or unsubscribed. Other matches are counted in totals.alreadyStopped. Defaults to the leads still being sent to."
    ),
  max_block_entries: z
    .number()
    .int()
    .min(1)
    .max(100_000)
    .default(10_000)
    .describe(
      "The most block list entries to read. A vendor request returns about 50 to 100. A lead on an entry past this cap is not found, so violations is null when entries are left unread."
    ),
  max_campaigns: z
    .number()
    .int()
    .min(1)
    .max(200)
    .default(200)
    .describe(
      "The most campaigns to check. Each costs one request per page of its leads. Defaults to the most allowed, so every campaign in the statuses is checked."
    ),
  max_leads_per_campaign: z
    .number()
    .int()
    .min(1)
    .max(20_000)
    .default(1000)
    .describe(
      "The most leads to read from each campaign. A campaign with more is checked only in part, so violations is null."
    ),
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
  /** Leads whose status is in `lead_statuses` that are on the block list. */
  readonly violations: number;
}

export interface SuppressionCheck {
  /**
   * The answer in one sentence, coverage first: how many violations in how
   * many campaigns, or what the caps left unread when the check is
   * incomplete. Never "none" from part of the data.
   */
  readonly finding: string;
  /** Leads still `active` first, then by campaign and lead. */
  readonly violations: readonly SuppressionViolation[];
  /** Every campaign checked, most violations first. */
  readonly byCampaign: readonly SuppressionCampaign[];
  readonly totals: {
    /**
     * Violations in every campaign and against every entry, or `null` when
     * a cap left campaigns, leads or block entries unread: the check is
     * incomplete and `violationsFound` is only a lower bound.
     */
    readonly violations: number | null;
    /** Violations in what was read. Raising a cap never lowers it. */
    readonly violationsFound: number;
    /**
     * Leads on the block list whose status is not in `lead_statuses`, so not
     * counted as violations: most often they unsubscribed (which is why they
     * are on the list), bounced or finished the sequence.
     */
    readonly alreadyStopped: number;
    readonly byMatch: {
      readonly email: number;
      readonly domain: number;
      readonly linkedin: number;
    };
    readonly campaignsRead: number;
    readonly leadsRead: number;
    readonly blockEntriesRead: number;
    /**
     * Entries that were not matched to leads: those of a kind that cannot be
     * (a company name or the vendor's `other`). `null` when
     * `moreBlockEntriesExist`, since the entries left unread were not
     * checked either and their number is unknown.
     */
    readonly blockEntriesNotChecked: number | null;
    /** `true` when `max_block_entries` stopped the read with more entries left: a lead on those was not found. */
    readonly moreBlockEntriesExist: boolean;
    /** `true` when `max_leads_per_campaign` stopped a campaign's read with more leads left. */
    readonly moreLeadsExist: boolean;
    /** Campaigns whose leads were read only in part. */
    readonly campaignsWithMoreLeads: number;
    /** `true` when `max_campaigns` or a request cap left campaigns in the statuses unread. */
    readonly moreCampaignsExist: boolean;
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

/**
 * `true` when redact masks profiles with its keyed token, written from the
 * slug for a lead's profile and a profile entry alike, so the tokens match.
 */
const profileTokens = (outbound: InsightContext["outbound"]): boolean => {
  const masking = maskingOf(outbound);

  return masking?.strategy === "mask" && masking.fields.includes("linkedin");
};

const indexEntries = (
  entries: readonly BlockEntry[],
  tokens: boolean
): Blocked => {
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
      blocked.linkedin.set(
        tokens ? entry.value : slugOfEntry(entry.value),
        entry
      );
    }
  }

  return blocked;
};

interface Hit {
  readonly entry: BlockEntry;
  readonly matchedBy: SuppressionMatch;
}

/** The most specific match: the exact address, then the profile, then the domain. */
const matchLead = (
  lead: Lead,
  blocked: Blocked,
  tokens: boolean
): Hit | null => {
  const slug = tokens ? lead.linkedinUrl : profileSlug(lead.linkedinUrl);

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

/**
 * What the redact plugin leaves unmatched. A masked or hashed address matches
 * the same entry, but its domain is gone. A masked profile matches by its
 * keyed token; a hashed one is the whole URL's, with no slug left to match.
 */
const maskNote = (outbound: InsightContext["outbound"]): string | null => {
  const fields = maskingOf(outbound)?.fields ?? [];
  const email = fields.includes("email");
  const linkedin = fields.includes("linkedin") && !profileTokens(outbound);

  const masked = [
    ...(email ? ["email addresses"] : []),
    ...(linkedin ? ["LinkedIn profiles"] : []),
  ];

  const lost = [
    ...(email ? ["domain entries"] : []),
    ...(linkedin ? ["LinkedIn profile entries"] : []),
  ];

  return masked.length === 0
    ? null
    : `The redact plugin masks ${masked.join(" and ")}, so ${lost.join(" and ")} could not be matched to leads.`;
};

const activeFirst = (
  left: SuppressionViolation,
  right: SuppressionViolation
): number =>
  Number(right.leadStatus === "active") -
    Number(left.leadStatus === "active") ||
  left.campaign.localeCompare(right.campaign) ||
  left.lead.localeCompare(right.lead);

/** What the caps left unread: campaigns, leads, and block entries when `entries` stopped short. */
const gapsOf = (
  checked: CampaignsChecked,
  entries: { readonly read: number; readonly cut: boolean } | null
): Gap[] => [
  ...campaignGaps(checked),
  ...(entries === null
    ? []
    : [
        {
          input: entries.cut ? null : "max_block_entries",
          read: `${plural(entries.read, "block list entry", "block list entries")}, with more unread`,
        },
      ]),
];

/** The answer in one sentence, what the check covered first. */
const findingOf = (
  violations: readonly SuppressionViolation[],
  campaigns: number,
  gaps: readonly Gap[]
): string => {
  const incomplete = gapsSentence(gaps);
  const inCampaigns = new Set(violations.map((each) => each.campaign)).size;

  const found = `${plural(violations.length, "lead still being sent to is", "leads still being sent to are")} on the block list, in ${plural(inCampaigns, "campaign")}`;

  if (incomplete === null) {
    if (campaigns === 0) {
      return "No lead still being sent to is on the block list: no campaign in those statuses was found to check.";
    }

    return violations.length === 0
      ? `No lead still being sent to is on the block list: every lead of ${plural(campaigns, "campaign")} was checked against every entry.`
      : `${found} of ${campaigns}.`;
  }

  return violations.length === 0
    ? `Not a clean result. No violation was found in what was read, but ${incomplete.charAt(0).toLowerCase()}${incomplete.slice(1)}`
    : `At least ${found}. ${incomplete}`;
};

export const suppressionCheck = defineInsight({
  description:
    "Leads sitting in campaigns although they are on the block list. Reads the block list, then the leads of each campaign in the given statuses (active by default), and matches a lead by exact email address, by email domain against domain entries, and by LinkedIn profile against profile entries. A match is a violation only when the lead's own status is in lead_statuses (active, paused or unknown by default, the leads still being sent to); a lead that already unsubscribed, bounced, replied or completed is counted in totals.alreadyStopped instead. Returns a finding sentence that leads with what was checked, each violation with the lead, the campaign, the entry and how it matched, and counts per campaign. Every campaign in the statuses is checked by default; when a cap leaves campaigns, leads or block entries unread, totals.violations is null, totals.violationsFound counts what was found, and the finding names each cap to raise, never a bare 0. On several tools an entry on one tool's list is also matched against the other tools' leads and marked sameTool false. Costs one request per page of block entries plus one per page of each campaign's leads.",
  inputSchema: input,
  key: "suppressionCheck",
  cost: (values, price) =>
    price.list("blocklist.list", values.max_block_entries) +
    price.campaignsIn(new Set(values.statuses).size, values.max_campaigns) +
    price.campaigns(values.max_campaigns) *
      price.list("leads.list", values.max_leads_per_campaign),
  scales: "max_campaigns",
  name: "suppression_check",
  needs: ["blocklist", "leads.byCampaign"],
  next: "Use person_summary with a violating lead's ref or email address to see what they were already sent.",
  run: async (context, values) => {
    const listed = await readCappedFlag(
      context,
      (cap) => context.outbound.blocklist.listAll({ max: cap }),
      values.max_block_entries,
      "block list entries",
      "max_block_entries"
    );

    const entries = listed.items;
    const tokens = profileTokens(context.outbound);
    const blocked = indexEntries(entries, tokens);
    const unmatched = maskNote(context.outbound);

    if (unmatched !== null) {
      context.partial(unmatched);
    }

    const listedCampaigns = await readCampaignsIn(
      context,
      values.statuses,
      values.max_campaigns
    );

    const campaigns = listedCampaigns.items;

    const sendable = new Set<string>(values.lead_statuses);
    const violations: SuppressionViolation[] = [];
    const byCampaign: SuppressionCampaign[] = [];
    let alreadyStopped = 0;

    const read = await mapConcurrent(campaigns, async (campaign) => ({
      campaign,
      ...(await readCappedFlag(
        context,
        (cap) =>
          context.outbound.campaign(campaign.ref).leads.listAll({ max: cap }),
        values.max_leads_per_campaign,
        "leads of a campaign",
        "max_leads_per_campaign"
      )),
    }));

    for (const { campaign, items: leads } of read) {
      const matched = leads.flatMap((lead) => {
        const hit = matchLead(lead, blocked, tokens);

        return hit === null ? [] : [toViolation(lead, campaign, hit)];
      });

      const found = matched.filter((each) => sendable.has(each.leadStatus));

      alreadyStopped += matched.length - found.length;

      violations.push(...found);
      byCampaign.push({
        campaign: campaign.ref,
        campaignName: campaign.name,
        leadsRead: leads.length,
        violations: found.length,
      });
    }

    const matches = tally(violations.map((each) => each.matchedBy));

    if (blocked.notChecked > 0) {
      context.partial(
        `${blocked.notChecked} of the block entries read name a company or another kind of entry no lead can be matched on, so they were not checked.`
      );
    }

    const campaignsWithMoreLeads = read.filter((each) => each.capped).length;

    const gaps = gapsOf(
      {
        campaigns: campaigns.length,
        campaignsCut: wasCutShort(campaigns),
        campaignsWithMoreLeads,
        leadsCut: read.filter((each) => wasCutShort(each.items)).length,
        maxLeads: values.max_leads_per_campaign,
        moreCampaignsExist: listedCampaigns.capped,
      },
      listed.capped ? { cut: wasCutShort(entries), read: entries.length } : null
    );

    const answer: SuppressionCheck = {
      finding: findingOf(violations, campaigns.length, gaps),
      byCampaign: byCampaign.toSorted(
        (left, right) =>
          right.violations - left.violations ||
          left.campaign.localeCompare(right.campaign)
      ),
      totals: {
        alreadyStopped,
        blockEntriesNotChecked: listed.capped ? null : blocked.notChecked,
        blockEntriesRead: entries.length,
        byMatch: {
          domain: matches.get("domain") ?? 0,
          email: matches.get("email") ?? 0,
          linkedin: matches.get("linkedin") ?? 0,
        },
        campaignsRead: campaigns.length,
        campaignsWithMoreLeads,
        leadsRead: byCampaign.reduce((sum, each) => sum + each.leadsRead, 0),
        moreBlockEntriesExist: listed.capped,
        moreCampaignsExist: listedCampaigns.capped,
        moreLeadsExist: campaignsWithMoreLeads > 0,
        violations: gaps.length === 0 ? violations.length : null,
        violationsFound: violations.length,
      },
      violations: violations.toSorted(activeFirst),
    };

    return answer;
  },
});
