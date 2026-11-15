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
import { AGENCY, NONE, slackScope } from "./slack-scope";
import type { Scope } from "./slack-scope";

export type { Scope } from "./slack-scope";

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

  return channelId === null ? NONE : slackScope(channelId, triggeringUserId);
};
