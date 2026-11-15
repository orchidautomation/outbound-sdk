// The agency's client roster and its Slack channels. Edit this file to add a
// client; the tools, the client channels and the Monday reports all read it.

import { assertRoster } from "./roster";

export type Provider = "heyreach" | "instantly" | "smartlead";

export interface Client {
  /** Your label for the client. It becomes the client's `workspaceId`. */
  readonly id: string;
  readonly name: string;
  readonly provider: Provider;
  /** The environment variable that holds this client's API key. */
  readonly apiKeyEnv: string;
  /**
   * The Slack channel the agency shares with this client. In that channel the
   * agent sees this client's data and nothing else, and the Monday report is
   * posted there. Leave it out for a client without a channel.
   */
  readonly slackChannelId?: string;
}

// One entry per client and sending tool. A client on two tools gets two
// entries with the same `id` and channel: `outbound.workspace(id)` then
// covers both accounts.
export const CLIENTS: readonly Client[] = assertRoster([
  {
    apiKeyEnv: "ACME_INSTANTLY_API_KEY",
    id: "acme",
    name: "Acme",
    provider: "instantly",
    slackChannelId: "C0ACME00000",
  },
  {
    apiKeyEnv: "GLOBEX_HEYREACH_API_KEY",
    id: "globex",
    name: "Globex",
    provider: "heyreach",
    slackChannelId: "C0GLOBEX000",
  },
]);

const idList = (value: string | undefined): string[] =>
  (value ?? "")
    .split(",")
    .map((id) => id.trim())
    .filter((id) => id !== "");

/** The team's channel, where the morning check posts. */
export const OPS_CHANNEL_ID =
  idList(process.env.OUTBOUND_OPS_CHANNEL_ID)[0] ?? undefined;

/**
 * The agency's own Slack channels, where the agent sees every client. A
 * channel not listed here or in the roster gets no client data at all.
 */
export const INTERNAL_CHANNEL_IDS: ReadonlySet<string> = new Set([
  ...idList(process.env.OUTBOUND_INTERNAL_CHANNEL_IDS),
  ...(OPS_CHANNEL_ID === undefined ? [] : [OPS_CHANNEL_ID]),
]);

/**
 * Teammates who may ask about every client in a direct message. Slack names
 * a Slack Connect guest by the agency's own workspace, so a DM cannot tell a
 * client's user from a teammate; only these user ids get data in a DM.
 */
export const TEAM_USER_IDS: ReadonlySet<string> = new Set(
  idList(process.env.OUTBOUND_TEAM_USER_IDS)
);

/** The client whose shared channel this is, if it is one. */
export const clientForChannel = (channelId: string): Client | undefined =>
  CLIENTS.find((client) => client.slackChannelId === channelId);
