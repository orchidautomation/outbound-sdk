// What of the inbox a sync run leaves out. Replies and messages tied to no
// campaign, such as HeyReach's inbox conversations, are in no campaign's
// listing, and replies.list reads them only with includeInbox, so a run
// that cannot reach them says so, with a count it cannot give.

import type { OutboundApi } from "../internal/outbound/api.ts";
import type { SyncCollection } from "./types.ts";

const CAMPAIGN_NOTE =
  "Replies tied to no campaign (HeyReach inbox conversations) belong to no campaign scope, so they were left out. A conversation does not name its campaign, so it cannot be matched to the scope, and counting them would read every campaign's conversations, so inboxLeftOut is null.";

const WORKSPACE_NOTE =
  "Replies tied to no campaign (HeyReach inbox conversations) were left out, because sync reads replies as replies.list does, without includeInbox. Counting them would read the whole inbox, so inboxLeftOut is null. Sync messages to get them: the messages collection lists the inbox's conversations too.";

export interface InboxLeftOut {
  /** `null` when some were left out and their count is unknown. */
  readonly count: number | null;
  readonly notes: readonly string[];
}

/**
 * What a run of `collection` leaves out of the inbox: a campaign's run
 * (`perCampaign`) leaves out its replies and messages, a workspace run only
 * its replies. `0` where the tool has no such inbox.
 */
export const inboxLeftOut = (
  outbound: Pick<OutboundApi, "capabilities">,
  collection: SyncCollection,
  perCampaign: boolean
): InboxLeftOut => {
  const nothingLeftOut =
    !outbound.capabilities["replies.inbox"] ||
    (collection !== "replies" && collection !== "messages") ||
    (!perCampaign && collection === "messages");

  if (nothingLeftOut) {
    return { count: 0, notes: [] };
  }

  return { count: null, notes: [perCampaign ? CAMPAIGN_NOTE : WORKSPACE_NOTE] };
};
