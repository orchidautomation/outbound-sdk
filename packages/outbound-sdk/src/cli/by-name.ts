// The CLI's options that take a campaign or list by name as well as by ref
// or id, and `campaigns --search`.

import type { Campaign, CampaignStatus } from "../internal/entities.ts";
import type { OutboundApi } from "../internal/outbound/api.ts";
import { plural } from "../internal/plural.ts";
import { resolveCampaign, resolveList } from "../tools/by-name.ts";

/** `--campaign` as the ref or id to read by, or `undefined` when not given. */
export const campaignOption = (
  outbound: OutboundApi,
  value: string | undefined
): Promise<string | undefined> =>
  value === undefined
    ? Promise.resolve(undefined)
    : resolveCampaign(outbound, value);

/** `--list` as the ref or id to read by, or `undefined` when not given. */
export const listOption = (
  outbound: OutboundApi,
  value: string | undefined
): Promise<string | undefined> =>
  value === undefined
    ? Promise.resolve(undefined)
    : resolveList(outbound, value);

/**
 * When `leads --campaign` or `--list` found no lead, reads the campaign or
 * list itself, so one that does not exist fails with `NotFound` as
 * `outbound campaign <id>` does, instead of printing an empty list. It costs
 * a request only when the list came back empty.
 */
export const confirmScope = async (
  outbound: OutboundApi,
  scope: {
    readonly campaignId?: string | undefined;
    readonly listId?: string | undefined;
  },
  found: number
): Promise<void> => {
  if (found > 0) {
    return;
  }

  if (scope.campaignId !== undefined) {
    await outbound.campaign(scope.campaignId).get();
  }

  if (scope.listId !== undefined && outbound.capabilities["lists.get"]) {
    await outbound.list(scope.listId).get();
  }
};

export interface CampaignSearch {
  readonly search: string;
  readonly status: CampaignStatus | undefined;
  readonly max: number;
  /** Writes a line for the person to stderr. */
  readonly note: (text: string) => void;
}

/**
 * The campaigns whose name contains `search`, ignoring case. No vendor
 * searches campaigns by name, so every campaign is read and matched here.
 */
export const searchCampaigns = async (
  outbound: OutboundApi,
  { max, note, search, status }: CampaignSearch
): Promise<Campaign[]> => {
  const wanted = search.trim().toLowerCase();
  const all = await outbound.campaigns.listAll({ status }).toArray();

  const matches = all.filter((campaign) =>
    campaign.name.toLowerCase().includes(wanted)
  );

  if (matches.length > max) {
    note(
      `Stopped at ${plural(max, "campaign")} of ${matches.length} that match. Pass --limit to read more.`
    );
  }

  return matches.slice(0, max);
};
