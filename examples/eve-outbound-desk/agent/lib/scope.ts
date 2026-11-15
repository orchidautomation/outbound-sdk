// What a conversation may see. It fails closed: a Slack conversation is
// given data only when this file can say whose it is.
//
// - A client's shared channel (lib/clients.ts) sees that client alone.
// - The agency's listed channels, and DMs from listed teammates, see every
//   client.
// - The eve HTTP API and its dev TUI see every client. Their callers are
//   authenticated in channels/eve.ts.
// - Anything else (a channel nobody listed, a DM from anyone else, a group
//   DM) sees nothing.

import { isChannel } from "eve/channels";
import type { InstrumentationChannel } from "eve/channels";

import eve from "../channels/eve";
import slack from "../channels/slack";
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

const AGENCY: Scope = { kind: "agency" };
const NONE: Scope = { kind: "none" };

// Slack direct-message channel ids start with D.
const isDirectMessage = (channelId: string): boolean =>
  channelId.startsWith("D");

export const scopeOf = (channel: InstrumentationChannel | undefined): Scope => {
  if (channel === undefined) {
    return NONE;
  }

  if (isChannel(channel, eve)) {
    return AGENCY;
  }

  if (!isChannel(channel, slack)) {
    return NONE;
  }

  const { channelId, triggeringUserId } = channel.metadata;

  if (channelId === null) {
    return NONE;
  }

  const client = clientForChannel(channelId);

  if (client !== undefined) {
    return { client, kind: "client" };
  }

  if (INTERNAL_CHANNEL_IDS.has(channelId)) {
    return AGENCY;
  }

  return isDirectMessage(channelId) &&
    triggeringUserId !== null &&
    TEAM_USER_IDS.has(triggeringUserId)
    ? AGENCY
    : NONE;
};
