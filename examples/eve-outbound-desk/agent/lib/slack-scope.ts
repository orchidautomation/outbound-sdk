// The scope of a Slack conversation, from its channel and the person in it.
// No channel imports, so the Slack channel's own hooks can use it too.

import {
  clientForChannel,
  INTERNAL_CHANNEL_IDS,
  TEAM_USER_IDS,
} from "./clients";
import type { Client } from "./clients";

export type Scope =
  | { readonly kind: "agency" }
  | { readonly kind: "client"; readonly client: Client }
  | { readonly kind: "none" };

export const AGENCY: Scope = { kind: "agency" };
export const NONE: Scope = { kind: "none" };

// Slack direct-message channel ids start with D.
const isDirectMessage = (channelId: string): boolean =>
  channelId.startsWith("D");

/** The scope of one Slack conversation, from its channel and the person in it. */
export const slackScope = (channelId: string, userId: string | null): Scope => {
  const client = clientForChannel(channelId);

  if (client !== undefined) {
    return { client, kind: "client" };
  }

  if (INTERNAL_CHANNEL_IDS.has(channelId)) {
    return AGENCY;
  }

  return isDirectMessage(channelId) &&
    userId !== null &&
    TEAM_USER_IDS.has(userId)
    ? AGENCY
    : NONE;
};
