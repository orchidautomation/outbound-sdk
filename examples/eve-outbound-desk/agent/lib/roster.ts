// Checks the roster once, when the agent loads (and so at `eve build`), so a
// typo can't put two clients in one channel or split a client across two.

import type { Client } from "./clients";

const problems = (clients: readonly Client[]): string[] => {
  const found: string[] = [];
  const clientOfChannel = new Map<string, string>();
  const channelOfClient = new Map<string, string | undefined>();
  const accounts = new Set<string>();

  for (const client of clients) {
    const account = `${client.id}/${client.provider}`;

    if (accounts.has(account)) {
      found.push(`${client.name} is listed twice on ${client.provider}.`);
    }

    accounts.add(account);

    if (
      channelOfClient.has(client.id) &&
      channelOfClient.get(client.id) !== client.slackChannelId
    ) {
      found.push(
        `Every entry for client "${client.id}" must have the same slackChannelId.`
      );
    }

    channelOfClient.set(client.id, client.slackChannelId);

    if (client.slackChannelId !== undefined) {
      const owner = clientOfChannel.get(client.slackChannelId);

      if (owner !== undefined && owner !== client.id) {
        found.push(
          `Slack channel ${client.slackChannelId} is given to both "${owner}" and "${client.id}".`
        );
      }

      clientOfChannel.set(client.slackChannelId, client.id);
    }
  }

  return found;
};

/** Returns the roster unchanged, or throws listing everything wrong with it. */
export const assertRoster = (clients: readonly Client[]): readonly Client[] => {
  const found = problems(clients);

  if (found.length > 0) {
    throw new Error(`agent/lib/clients.ts: ${found.join(" ")}`);
  }

  return clients;
};
