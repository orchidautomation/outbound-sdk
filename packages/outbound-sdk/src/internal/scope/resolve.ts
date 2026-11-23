// resolveScope: the campaigns a campaign scope covers, found the way every
// insight and sync.run find them, for a caller that reads them itself.

import type { Campaign, Evidence } from "../entities.ts";
import { OutboundError } from "../errors.ts";
import type { OutboundApi, ResultMeta } from "../outbound/api.ts";
import { refuseTagless, scopeCampaigns } from "./campaigns.ts";
import type { ScopeTool } from "./campaigns.ts";
import { describeScope, parseScope } from "./rule.ts";
import type { CampaignScope, CampaignScopeInput } from "./rule.ts";

export interface ResolvedScopeMeta {
  readonly provider: string;
  readonly workspaceId: string;
  /** Vendor requests made to find the campaigns. */
  readonly requests: number;
  /** `exact` when the listing or lookups behind it were; a scope matched here over a whole listing is still exact. */
  readonly evidence: Evidence;
  /** The scope in words: `tag client-a and name Acme*`. */
  readonly scope: string;
  /** How each tool's campaigns were found: by id, by the vendor's filter, or matched here. */
  readonly tools: readonly ScopeTool[];
  /** How many campaigns matched on each tool, and which side filtered. */
  readonly notes: readonly string[];
}

export interface ResolvedScope {
  /** Every campaign the scope covers, in every state. */
  readonly campaigns: readonly Campaign[];
  readonly meta: ResolvedScopeMeta;
}

const RANK: Readonly<Record<Evidence, number>> = {
  derived: 2,
  exact: 0,
  sampled: 1,
};

/** Finds a parsed scope's campaigns, recording what it cost. */
export const findScope = async (
  outbound: OutboundApi,
  scope: CampaignScope,
  label: string
): Promise<ResolvedScope> => {
  await refuseTagless(outbound, label, scope);

  const notes: string[] = [];
  const tools: ScopeTool[] = [];
  let requests = 0;
  let evidence: Evidence = "exact";

  const seen = (meta: ResultMeta | undefined): void => {
    if (meta === undefined) {
      return;
    }

    requests += meta.requests;
    evidence = RANK[meta.evidence] > RANK[evidence] ? meta.evidence : evidence;
  };

  const campaigns = await scopeCampaigns(outbound, scope, {
    all: async (walk) => {
      const items = await walk.toArray();
      seen(walk.meta);

      return items;
    },
    found: (tool) => tools.push(tool),
    insight: label,
    note: (text) => {
      if (!notes.includes(text)) {
        notes.push(text);
      }
    },
    now: Date.now(),
    one: (item) => {
      seen(item.meta);

      return item;
    },
  });

  return {
    campaigns,
    meta: {
      evidence,
      notes,
      provider: outbound.provider,
      requests,
      scope: describeScope(scope),
      tools,
      workspaceId: outbound.workspaceId,
    },
  };
};

/**
 * The campaigns a campaign scope covers, every state, found as an insight
 * finds them: ids read by id with no listing, a tag or name sent to the
 * vendor where it filters its listing and matched here otherwise. A
 * malformed scope, or one with no part given, is `Invalid`, and a tag where
 * campaigns carry no tags `Unsupported`, before any request.
 *
 * ```ts
 * const { campaigns, meta } = await resolveScope(outbound, { tag: "client-a" });
 * ```
 */
export const resolveScope = async (
  outbound: OutboundApi,
  input: CampaignScopeInput
): Promise<ResolvedScope> => {
  const scope = parseScope(input, "resolveScope");

  if (scope === null) {
    throw new OutboundError(
      "Invalid",
      "resolveScope: give at least one of campaign_ids, tag and campaign_name",
      { provider: outbound.provider }
    );
  }

  return await findScope(outbound, scope, "resolveScope");
};
