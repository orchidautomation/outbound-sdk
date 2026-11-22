// The part of the app that knows outbound-sdk and nothing about Executor:
// the accounts a caller linked become one read-only instance, and that
// instance becomes outbound-sdk's agent tools: the built-in ones and the
// insights, one Executor tool each.
//
// Two copies of this file are kept byte for byte equal:
// examples/executor-outbound/outbound.ts, which the app deploys, and
// site/content/_examples/executor/outbound.ts, which the site's tests run.

import { createOutbound } from "outbound-sdk";
import type { Adapter, OutboundApi } from "outbound-sdk";
import { combine } from "outbound-sdk/combine";
import { emailbison } from "outbound-sdk/emailbison";
import { heyreach } from "outbound-sdk/heyreach";
import { identity } from "outbound-sdk/identity";
import { insightTools, membersOf } from "outbound-sdk/insights";
import { instantly } from "outbound-sdk/instantly";
import { redact } from "outbound-sdk/redact";
import { smartlead } from "outbound-sdk/smartlead";
import { createTools } from "outbound-sdk/tools";
import type { OutboundTool } from "outbound-sdk/tools";

/** One linked account: its key, and the client it belongs to. */
export interface KeyAccount {
  readonly id: string;
  readonly fields: {
    readonly apiKey: string;
    readonly client?: string | undefined;
  };
}

/** EmailBison runs one instance per customer, so its account also names the URL. */
export interface EmailBisonAccount extends KeyAccount {
  readonly fields: KeyAccount["fields"] & { readonly baseUrl: string };
}

/** Every account the caller linked, per vendor. Any list may be empty. */
export interface LinkedAccounts {
  readonly instantly: readonly KeyAccount[];
  readonly smartlead: readonly KeyAccount[];
  readonly heyreach: readonly KeyAccount[];
  readonly emailbison: readonly EmailBisonAccount[];
}

// The client label becomes each record's workspaceId. Without one, the
// vendor and the account's place in the list tell two keys apart.
const label = (vendor: string, account: KeyAccount, index: number): string =>
  account.fields.client?.trim() || `${vendor}-${index + 1}`;

const adaptersFor = (accounts: LinkedAccounts): Adapter[] => [
  ...accounts.instantly.map((account, index) =>
    instantly({
      apiKey: account.fields.apiKey,
      workspaceId: label("instantly", account, index),
    })
  ),
  ...accounts.smartlead.map((account, index) =>
    smartlead({
      apiKey: account.fields.apiKey,
      workspaceId: label("smartlead", account, index),
    })
  ),
  ...accounts.heyreach.map((account, index) =>
    heyreach({
      apiKey: account.fields.apiKey,
      workspaceId: label("heyreach", account, index),
    })
  ),
  ...accounts.emailbison.map((account, index) =>
    emailbison({
      apiKey: account.fields.apiKey,
      baseUrl: account.fields.baseUrl,
      workspaceId: label("emailbison", account, index),
    })
  ),
];

/**
 * One instance over every linked account, sending its requests through
 * `fetch`, or `undefined` when nothing is linked. Personal fields are masked,
 * as `outbound mcp` masks them, because the answers go to an agent.
 */
export const outboundFor = (
  accounts: LinkedAccounts,
  fetch: typeof globalThis.fetch
): OutboundApi | undefined => {
  const adapters = adaptersFor(accounts);
  const [only] = adapters;

  if (only === undefined) {
    return undefined;
  }

  return createOutbound({
    adapter: adapters.length === 1 ? only : combine(adapters),
    fetch,
    plugins: [redact(), identity()],
  });
};

/**
 * The built-in tools and the insights this instance can serve. Unlike
 * `outbound mcp`, which merges some neighbours into one tool, each is its own.
 */
export const toolsFor = async (
  outbound: OutboundApi
): Promise<OutboundTool[]> => {
  const members = await membersOf(outbound);

  return createTools(outbound, {
    extra: insightTools(outbound, { members }),
    members,
  });
};
