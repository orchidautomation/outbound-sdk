// Which Smartlead campaigns measured opens and clicks, for `stats`.
//
// `track_settings` on the campaign lists what is not tracked, on
// `GET /campaigns/{id}` and on each campaign of `GET /campaigns/`. One
// campaign costs one request. A workspace or mailbox total costs the
// per-campaign report for the range (`GET /analytics/campaign/overall-stats`)
// and the campaign list, which comes in one request.

import type { AdapterContext } from "../internal/adapter.ts";
import { count, field, objects, text } from "../internal/json.ts";
import type { JsonObject } from "../internal/json.ts";
import type { CampaignTracking, TrackingFlags } from "../internal/tracking.ts";
import { unlessFailed } from "../internal/tracking.ts";
import type { SmartleadClient } from "./client.ts";
import { trackingFlags } from "./map-account.ts";
import { TIMEZONE } from "./map-stats.ts";
import { campaignList, objectOf } from "./shared.ts";

const UNKNOWN: TrackingFlags = { clicks: null, opens: null };

/** One campaign's settings, or `null` when they could not be read. */
export const campaignFlags = async (
  client: SmartleadClient,
  ctx: AdapterContext,
  campaignId: string
): Promise<TrackingFlags | null> =>
  await unlessFailed(async () =>
    trackingFlags(
      objectOf(
        client,
        await client.get(ctx, `/campaigns/${encodeURIComponent(campaignId)}`),
        "the campaign"
      )
    )
  );

/** Every campaign's settings by id, or `null` when the list failed. */
export const everyCampaignFlags = async (
  client: SmartleadClient,
  ctx: AdapterContext
): Promise<Map<string, TrackingFlags> | null> =>
  await unlessFailed(async () => {
    const campaigns = await campaignList(client, ctx);

    return new Map(
      campaigns.flatMap((campaign) => {
        const id = text(campaign.id);

        return id === null ? [] : [[id, trackingFlags(campaign)] as const];
      })
    );
  });

const plus = (left: number | null, right: number | null): number | null =>
  left === null && right === null ? null : (left ?? 0) + (right ?? 0);

/**
 * One campaign's row of the per-campaign report with its settings. The
 * report has no click count, so a campaign with link tracking off counts as
 * not measuring clicks.
 */
export const reportTracking = (
  raw: JsonObject,
  flags: TrackingFlags | undefined
): CampaignTracking => ({
  clicked: null,
  flags: flags ?? UNKNOWN,
  opened: plus(count(raw.unique_open_count), count(raw.opened)),
  sent: count(raw.sent),
});

/**
 * Every campaign behind a workspace or mailbox total over the range, or
 * `null` when either read failed.
 */
export const workspaceTracking = async (
  client: SmartleadClient,
  ctx: AdapterContext,
  range: { readonly from: string; readonly to: string }
): Promise<CampaignTracking[] | null> => {
  const report = await unlessFailed(async () =>
    objects(
      field(
        objectOf(
          client,
          await client.get(ctx, "/analytics/campaign/overall-stats", {
            query: {
              end_date: range.to,
              full_data: true,
              start_date: range.from,
              timezone: TIMEZONE,
            },
          }),
          "campaign performance"
        ),
        "campaign_wise_performance"
      )
    )
  );

  if (report === null) {
    return null;
  }

  const flags = await everyCampaignFlags(client, ctx);

  return flags === null
    ? null
    : report.map((raw) => reportTracking(raw, flags.get(text(raw.id) ?? "")));
};
