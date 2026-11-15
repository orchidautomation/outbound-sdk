// Telling an unknown campaign from an empty one. A read scoped to a campaign
// that does not exist can come back empty, which would read as "nothing
// happened". Called only when such a read is empty, so a known campaign with
// data costs nothing extra.

import type { InsightContext } from "./define.ts";

/** Reads the campaign, which throws `NotFound` when it does not exist. One request. */
export const confirmCampaign = async (
  context: InsightContext,
  campaign: string
): Promise<void> => {
  context.one(await context.outbound.campaigns.get(campaign));
};
