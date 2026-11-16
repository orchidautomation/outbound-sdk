// Which Instantly campaigns measured opens and clicks, for `stats`.
//
// The settings are `open_tracking` and `link_tracking` on the campaign, on
// `GET /campaigns/{id}` and on each item of `GET /campaigns`. One campaign
// costs one request. A workspace or sender total costs the per-campaign
// report (`GET /campaigns/analytics`) for who sent in the range, plus the
// campaign listing, a page per 100 campaigns.

import type { AdapterContext } from "../internal/adapter.ts";
import { count, flag, text } from "../internal/json.ts";
import type { JsonObject } from "../internal/json.ts";
import type { CampaignTracking, TrackingFlags } from "../internal/tracking.ts";
import { unlessFailed } from "../internal/tracking.ts";
import type { InstantlyClient } from "./client.ts";
import { readLookup } from "./pages.ts";

/** Campaign listing pages read at most: 1,000 campaigns. */
const LISTING_PAGES = 10;

const UNKNOWN: TrackingFlags = { clicks: null, opens: null };

export const trackingFlags = (raw: JsonObject): TrackingFlags => ({
  clicks: flag(raw.link_tracking),
  opens: flag(raw.open_tracking),
});

/** One campaign's settings, or `null` when they could not be read. */
export const campaignFlags = async (
  client: InstantlyClient,
  ctx: AdapterContext,
  campaignId: string
): Promise<TrackingFlags | null> =>
  await unlessFailed(async () =>
    trackingFlags(
      await client.getObject(
        ctx,
        `/campaigns/${encodeURIComponent(campaignId)}`
      )
    )
  );

/** Every campaign's settings by id, or `null` when the listing failed. */
export const everyCampaignFlags = async (
  client: InstantlyClient,
  ctx: AdapterContext
): Promise<Map<string, TrackingFlags> | null> =>
  await unlessFailed(async () => {
    const campaigns = await readLookup(client, ctx, {
      filters: {},
      pages: LISTING_PAGES,
      path: "/campaigns",
    });

    return new Map(
      campaigns.flatMap((campaign) => {
        const id = text(campaign.id);

        return id === null ? [] : [[id, trackingFlags(campaign)] as const];
      })
    );
  });

const plus = (left: number | null, right: number | null): number | null =>
  left === null && right === null ? null : (left ?? 0) + (right ?? 0);

/** One campaign's row of `GET /campaigns/analytics` with its settings. */
export const reportTracking = (
  raw: JsonObject,
  flags: TrackingFlags | undefined
): CampaignTracking => ({
  clicked: plus(
    count(raw.link_click_count_unique),
    count(raw.link_click_count)
  ),
  flags: flags ?? UNKNOWN,
  opened: plus(count(raw.open_count_unique), count(raw.open_count)),
  sent: count(raw.emails_sent_count),
});

/**
 * Every campaign behind a workspace or sender total over the range, or
 * `null` when either read failed.
 */
export const workspaceTracking = async (
  client: InstantlyClient,
  ctx: AdapterContext,
  range: {
    readonly start_date: string | undefined;
    readonly end_date: string | undefined;
  }
): Promise<CampaignTracking[] | null> => {
  const report = await unlessFailed(
    async () =>
      await client.getRows(ctx, "/campaigns/analytics", { query: range })
  );

  if (report === null) {
    return null;
  }

  const flags = await everyCampaignFlags(client, ctx);

  return flags === null
    ? null
    : report.map((raw) =>
        reportTracking(raw, flags.get(text(raw.campaign_id) ?? ""))
      );
};
