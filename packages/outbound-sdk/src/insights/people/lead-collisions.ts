// lead_collisions: people being contacted by more than one campaign at once,
// and on request people who were in one campaign and are now in another.

import { z } from "zod";

import { mapConcurrent } from "../../internal/concurrency.ts";
import type { Campaign, Lead } from "../../internal/entities.ts";
import { shownKey } from "../../internal/plural.ts";
import { defineInsight, maskingOf } from "../define.ts";
import { keysOfLead } from "./find.ts";
import { campaignsIn, leadsOf, statusesField } from "./read.ts";

const input = z.object({
  include_past: z
    .boolean()
    .default(false)
    .describe(
      "Also report a person in two or more campaigns of whom fewer than two memberships are still active, for example one who completed one campaign and is now in another. By default only people active in two or more campaigns at once are reported."
    ),
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
  /** Campaigns in which the lead's own status is still `active`. Two or more means the outreach overlaps now. */
  readonly stillActive: number;
  /** `across_tools` when the campaigns are in more than one tool, otherwise `within_tool`. */
  readonly scope: "across_tools" | "within_tool";
  readonly providers: readonly string[];
  readonly channels: readonly string[];
  readonly campaigns: readonly CollisionCampaign[];
  readonly finding: string;
}

export interface LeadCollisions {
  /** Most active campaigns first, then most campaigns, then collisions across tools, then by identifier. */
  readonly collisions: readonly LeadCollision[];
  readonly totals: {
    readonly collisions: number;
    /** Collisions returned in which two or more memberships are still active. */
    readonly concurrent: number;
    /**
     * People in two or more campaigns of whom fewer than two memberships are
     * still active. They are in `collisions` only with `include_past`.
     */
    readonly pastOverlaps: number;
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
  const active = campaigns.filter((each) => each.leadStatus === "active");

  return [
    {
      campaignCount: campaigns.length,
      campaigns,
      channels,
      finding: findingOf(shownKey(identifiers[0] ?? ""), campaigns, {
        channels,
        providers,
      }),
      identifiers,
      providers,
      scope,
      stillActive: active.length,
    },
  ];
};

/** `"A"`, `"A" and "B"`, `"A", "B" and "C"`. */
const listed = (parts: readonly string[]): string =>
  parts.length < 2
    ? (parts[0] ?? "")
    : `${parts.slice(0, -1).join(", ")} and ${parts.at(-1)}`;

const named = (campaigns: readonly CollisionCampaign[]): string =>
  listed(campaigns.map((each) => `"${each.campaignName}"`));

const withStatus = (campaigns: readonly CollisionCampaign[]): string =>
  listed(
    campaigns.map((each) => `"${each.campaignName}" (${each.leadStatus})`)
  );

/**
 * Says "at once" only when two or more memberships are still active; a
 * membership that stopped is named with its status as a past one.
 */
const findingOf = (
  who: string,
  campaigns: readonly CollisionCampaign[],
  tools: {
    readonly providers: readonly string[];
    readonly channels: readonly string[];
  }
): string => {
  const active = campaigns.filter((each) => each.leadStatus === "active");
  const past = campaigns.filter((each) => each.leadStatus !== "active");

  if (active.length >= 2) {
    const where =
      tools.providers.length > 1
        ? `campaigns across ${tools.providers.join(" and ")} (${tools.channels.join(" and ")})`
        : `${tools.providers[0]} campaigns`;

    const also = past.length === 0 ? "" : `, and was in ${withStatus(past)}`;

    return `${who} is in ${active.length} ${where} at once${also}.`;
  }

  return active.length === 0
    ? `${who} was in ${withStatus(past)}, and is active in none of them now.`
    : `${who} was in ${withStatus(past)} and is now active in ${named(active)}.`;
};

const worstFirst = (left: LeadCollision, right: LeadCollision): number =>
  right.stillActive - left.stillActive ||
  right.campaignCount - left.campaignCount ||
  left.scope.localeCompare(right.scope) ||
  (left.identifiers[0] ?? "").localeCompare(right.identifiers[0] ?? "");

export const leadCollisions = defineInsight({
  description:
    "People who are in two or more campaigns at once, so they get overlapping outreach. Reads the campaigns in the given statuses (active by default) and their leads, matches people by exact email address or LinkedIn profile, and returns each person with their campaigns, channel and tool, most active campaigns first. By default a person counts only when their own status is active in two or more of the campaigns; include_past also reports people who finished, replied to or left one campaign and are in another, counted in totals.pastOverlaps either way. A collision across tools (for example email in one and LinkedIn in another) is marked across_tools; one inside a tool is within_tool. Costs one request per page of campaigns plus one per page of each campaign's leads; the caps make the answer incomplete rather than slow.",
  inputSchema: input,
  key: "leadCollisions",
  // A masked address is the same text for every lead, so every lead would
  // collide with every other. A hashed one still tells people apart.
  maskedOut: ({ fields, strategy }) =>
    fields.includes("email") && strategy === "mask"
      ? "email addresses, which it matches people by"
      : null,
  cost: (values, price) =>
    price.campaignsIn(new Set(values.statuses).size, values.max_campaigns) +
    price.campaigns(values.max_campaigns) *
      price.list("leads.list", values.max_leads_per_campaign),
  scales: "max_campaigns",
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
        values.max_leads_per_campaign,
        "max_leads_per_campaign"
      );

      return leads.map((lead): Entry => ({ campaign, lead }));
    });

    const entries = perCampaign.flat();

    const overlaps = groupPeople(entries).flatMap(toCollision);
    const pastOverlaps = overlaps.filter((each) => each.stillActive < 2).length;

    const collisions = overlaps
      .filter((each) => values.include_past || each.stillActive >= 2)
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
        concurrent: collisions.filter((each) => each.stillActive >= 2).length,
        leadsRead: entries.length,
        leadsWithoutIdentifier: entries.filter(
          (entry) => keysOfLead(entry.lead).length === 0
        ).length,
        pastOverlaps,
        withinTool: collisions.length - acrossTools,
      },
    };

    return answer;
  },
});
