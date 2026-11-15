// lead_collisions: people being contacted by more than one campaign at once.

import { z } from "zod";

import { mapConcurrent } from "../../internal/concurrency.ts";
import type { Campaign, Lead } from "../../internal/entities.ts";
import { defineInsight, maskingOf } from "../define.ts";
import { keysOfLead } from "./find.ts";
import { campaignsIn, leadsOf, statusesField } from "./read.ts";

const input = z.object({
  max_campaigns: z
    .number()
    .int()
    .min(1)
    .max(200)
    .default(20)
    .describe(
      "The most campaigns to read. Each costs one request per page of its leads."
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

export interface CollisionCampaign {
  readonly campaign: string;
  readonly campaignName: string;
  readonly channel: "email" | "linkedin";
  readonly provider: string;
  readonly lead: string;
  readonly leadStatus: string;
}

export interface LeadCollision {
  /** Every exact identifier the person's records carry, as `email:` or `linkedin:` keys. */
  readonly identifiers: readonly string[];
  readonly campaignCount: number;
  /** Campaigns in which the lead's own status is still `active`. */
  readonly stillActive: number;
  /** `across_tools` when the campaigns are in more than one tool, otherwise `within_tool`. */
  readonly scope: "across_tools" | "within_tool";
  readonly providers: readonly string[];
  readonly channels: readonly string[];
  readonly campaigns: readonly CollisionCampaign[];
  readonly finding: string;
}

export interface LeadCollisions {
  /** Most campaigns first, then collisions across tools, then by identifier. */
  readonly collisions: readonly LeadCollision[];
  readonly totals: {
    readonly collisions: number;
    readonly acrossTools: number;
    readonly withinTool: number;
    readonly campaignsRead: number;
    readonly leadsRead: number;
    /** Leads with neither an email address nor a LinkedIn profile, which cannot be matched. */
    readonly leadsWithoutIdentifier: number;
  };
}

interface Entry {
  readonly lead: Lead;
  readonly campaign: Campaign;
}

interface Group {
  readonly keys: Set<string>;
  readonly entries: Entry[];
}

/**
 * Groups records that share an exact identifier. A record that carries both
 * an email address and a profile joins the group of each, merging them.
 */
const groupPeople = (entries: readonly Entry[]): Group[] => {
  const byKey = new Map<string, Group>();

  for (const entry of entries) {
    const keys = keysOfLead(entry.lead);
    const found = new Set(keys.flatMap((key) => byKey.get(key) ?? []));
    const group: Group = { entries: [entry], keys: new Set(keys) };

    for (const other of found) {
      group.entries.unshift(...other.entries);

      for (const key of other.keys) {
        group.keys.add(key);
      }
    }

    for (const key of group.keys) {
      byKey.set(key, group);
    }
  }

  return [...new Set(byKey.values())];
};

const toCollision = (group: Group): LeadCollision[] => {
  // One entry per campaign: the same person twice in one campaign is not a collision.
  const perCampaign = new Map(
    group.entries.map((entry) => [entry.campaign.ref, entry])
  );

  if (perCampaign.size < 2) {
    return [];
  }

  const campaigns = [...perCampaign.values()].map(({ campaign, lead }) => ({
    campaign: campaign.ref,
    campaignName: campaign.name,
    channel: campaign.channel,
    lead: lead.ref,
    leadStatus: lead.status,
    provider: campaign.provider,
  }));

  const providers = [...new Set(campaigns.map((each) => each.provider))];
  const channels = [...new Set(campaigns.map((each) => each.channel))];
  const scope = providers.length > 1 ? "across_tools" : "within_tool";
  const identifiers = [...group.keys].toSorted();

  return [
    {
      campaignCount: campaigns.length,
      campaigns,
      channels,
      finding:
        scope === "across_tools"
          ? `${identifiers[0]} is in ${campaigns.length} campaigns across ${providers.join(" and ")} (${channels.join(" and ")}).`
          : `${identifiers[0]} is in ${campaigns.length} ${providers[0]} campaigns at once.`,
      identifiers,
      providers,
      scope,
      stillActive: campaigns.filter((each) => each.leadStatus === "active")
        .length,
    },
  ];
};

const worstFirst = (left: LeadCollision, right: LeadCollision): number =>
  right.campaignCount - left.campaignCount ||
  left.scope.localeCompare(right.scope) ||
  (left.identifiers[0] ?? "").localeCompare(right.identifiers[0] ?? "");

export const leadCollisions = defineInsight({
  description:
    "People who are in two or more campaigns at once, so they get overlapping outreach. Reads the campaigns in the given statuses (active by default) and their leads, matches people by exact email address or LinkedIn profile, and returns each person with their campaigns, channel and tool, most campaigns first. A collision across tools (for example email in one and LinkedIn in another) is marked across_tools; one inside a tool is within_tool. Costs one request per page of campaigns plus one per page of each campaign's leads; the caps make the answer incomplete rather than slow.",
  inputSchema: input,
  key: "leadCollisions",
  // A masked address is the same text for every lead, so every lead would
  // collide with every other. A hashed one still tells people apart.
  maskedOut: ({ fields, strategy }) =>
    fields.includes("email") && strategy === "mask"
      ? "email addresses, which it matches people by"
      : null,
  name: "lead_collisions",
  needs: ["leads.byCampaign"],
  next: "Use person_summary with one of the identifiers or lead refs to see what that person was sent and whether they replied.",
  run: async (context, values) => {
    if (maskingOf(context.outbound)?.fields.includes("linkedin") === true) {
      context.partial(
        "The redact plugin masks LinkedIn profiles, so people were matched by email address only."
      );
    }

    const campaigns = await campaignsIn(
      context,
      values.statuses,
      values.max_campaigns
    );

    const perCampaign = await mapConcurrent(campaigns, async (campaign) => {
      const leads = await leadsOf(
        context,
        campaign.ref,
        values.max_leads_per_campaign
      );

      return leads.map((lead): Entry => ({ campaign, lead }));
    });

    const entries = perCampaign.flat();

    const collisions = groupPeople(entries)
      .flatMap(toCollision)
      .toSorted(worstFirst);

    const acrossTools = collisions.filter(
      (each) => each.scope === "across_tools"
    ).length;

    const answer: LeadCollisions = {
      collisions,
      totals: {
        acrossTools,
        campaignsRead: campaigns.length,
        collisions: collisions.length,
        leadsRead: entries.length,
        leadsWithoutIdentifier: entries.filter(
          (entry) => keysOfLead(entry.lead).length === 0
        ).length,
        withinTool: collisions.length - acrossTools,
      },
    };

    return answer;
  },
});
