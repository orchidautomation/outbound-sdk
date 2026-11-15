// The agency's client roster: one entry per client, each with its own key on
// its own sending tool. Edit this file to add a client; the tools, the client
// channels and the Monday reports all read it.

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

export const CLIENTS: readonly Client[] = [
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
];

/** The internal channel where the team works and the morning check posts. */
export const OPS_CHANNEL_ID = process.env.OUTBOUND_OPS_CHANNEL_ID;

/** The client whose shared channel this is, if it is one. */
export const clientForChannel = (
  channelId: string | null | undefined
): Client | undefined =>
  channelId === null || channelId === undefined
    ? undefined
    : CLIENTS.find((client) => client.slackChannelId === channelId);
