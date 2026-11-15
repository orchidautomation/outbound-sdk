// Which client a conversation may see. In a client's shared Slack channel the
// answer is that client alone; everywhere else (the team's own channels, DMs,
// the eve TUI) it is the whole agency.

import { isChannel } from "eve/channels";
import type { InstrumentationChannel } from "eve/channels";

import slack from "../channels/slack";
import { clientForChannel } from "./clients";
import type { Client } from "./clients";

export const clientInScope = (
  channel: InstrumentationChannel | undefined
): Client | undefined =>
  channel !== undefined && isChannel(channel, slack)
    ? clientForChannel(channel.metadata.channelId)
    : undefined;
