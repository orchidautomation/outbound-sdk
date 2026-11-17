// What an adapter can do. Anything an adapter does not declare reads as
// unsupported, so an adapter that says nothing never advertises a wrong
// "yes". The wrapper checks these before any HTTP call and before any plugin.

import { OutboundError } from "./errors.ts";

/** Whether the vendor filters for us, we filter after fetching, or neither. */
export type FilterGrade = "client" | "server" | false;

/** Whether numbers come straight from the vendor or are computed by us. */
export type StatGrade = "derived" | "exact" | false;

export interface Capabilities {
  /** Filter campaigns by status. */
  "campaigns.status": FilterGrade;
  /** List the campaigns one sender is attached to. */
  "campaigns.bySender": boolean;
  /** How many of a campaign's leads are waiting, in progress, finished or stopped. */
  "campaigns.progress": boolean;
  /** A campaign's schedule, daily caps, tracking and stop rules. */
  "campaigns.settings": boolean;
  /** A campaign's steps and variants. */
  sequence: boolean;
  /** The follow-up sequences attached to a campaign. */
  "sequence.subsequences": boolean;
  /** List every sender on the credential. */
  "senders.list": boolean;
  "senders.get": boolean;
  /** List the senders attached to one campaign. Does not need `senders.list`. */
  "senders.byCampaign": boolean;
  "senders.warmup": boolean;
  /** DNS records, connection state and warmup traffic for one sender. */
  "senders.health": boolean;
  /** The same health for every sender, a page at a time, in a few requests a page instead of a few per sender. */
  "senders.healthList": boolean;
  /** List every lead on the credential, across campaigns. */
  "leads.list": boolean;
  "leads.get": boolean;
  /** List the leads of one campaign. Does not need `leads.list`. */
  "leads.byCampaign": boolean;
  "leads.since": FilterGrade;
  /** Find a lead by its exact email address or LinkedIn profile, without walking every lead. */
  "leads.lookup": boolean;
  /** Find the leads whose email address is at one domain, without walking every lead. */
  "leads.byDomain": boolean;
  /** Find the leads of many exact email addresses in one listing, without one lookup each. */
  "leads.lookupMany": boolean;
  /** List only the leads the vendor labels positive, without walking every lead. */
  "leads.byInterest": boolean;
  /** List only the active leads, those still in the sequence, without walking every lead. */
  "leads.byStatus": boolean;
  /** Leads carry open, click and reply counts. */
  "leads.engagement": boolean;
  /** List the saved lead lists. */
  "lists.list": boolean;
  /** One saved lead list by id. */
  "lists.get": boolean;
  /** List the leads of one saved list. */
  "lists.leads": boolean;
  /** Every message for one lead, in order. */
  "leads.timeline": boolean;
  "messages.list": boolean;
  /** Whether message bodies are returned: all, some, or none. */
  "messages.body": "full" | "sampled" | false;
  "messages.since": FilterGrade;
  /** Every message of one conversation, by its thread id. */
  "messages.byThread": boolean;
  /** Only the messages a person sent by hand, not the ones a campaign sent. */
  "messages.byHand": boolean;
  "replies.list": boolean;
  /** Reply categories come from the vendor, or are not available. */
  "replies.category": "vendor" | false;
  "replies.since": FilterGrade;
  /** Only the replies that are unread, or only the ones that are read. */
  "replies.unread": FilterGrade;
  /**
   * The vendor's inbox also holds conversations that belong to no campaign,
   * such as a LinkedIn account's own messages. Their replies are left out of
   * `replies.list` unless it is asked for `includeInbox`, and their messages
   * and replies carry a null `campaignRef`.
   */
  "replies.inbox": boolean;
  "stats.workspace": StatGrade;
  "stats.campaign": StatGrade;
  /**
   * One row per campaign in a single call: `stats({ scope: "campaign" })` with
   * no campaign named. `full` when each row carries every count the read of
   * one campaign does, `partial` when the vendor's report has fewer.
   */
  "stats.allCampaigns": "full" | "partial" | false;
  "stats.byDay": StatGrade;
  "stats.byStep": StatGrade;
  "stats.bySender": StatGrade;
  workspaces: boolean;
  /** The addresses, domains and profiles the account never contacts. */
  blocklist: boolean;
  /** List the inbox placement tests the account has set up. */
  "placementTests.list": boolean;
  tags: boolean;
  /** The webhooks registered with the vendor. */
  "webhooks.list": boolean;
  /** One webhook subscription by id. */
  "webhooks.get": boolean;
  /** The vendor's own reads are available by name through `outbound.native`. */
  native: boolean;
  /** Webhook payloads can be parsed into `OutboundEvent`s. */
  "events.parse": boolean;
  /** How a webhook is authenticated. */
  "events.verify": "secret" | "signature" | false;
  /** Whether list calls reveal deleted records. */
  deletionDetection: boolean;
}

export type CapabilityKey = keyof Capabilities;

export type CapabilityDeclaration = Partial<Capabilities>;

type CapabilityValue = Capabilities[CapabilityKey];

export const NO_CAPABILITIES: Capabilities = {
  blocklist: false,
  "campaigns.bySender": false,
  "campaigns.progress": false,
  "campaigns.settings": false,
  "campaigns.status": false,
  deletionDetection: false,
  "events.parse": false,
  "events.verify": false,
  "leads.byCampaign": false,
  "leads.byDomain": false,
  "leads.byInterest": false,
  "leads.byStatus": false,
  "leads.engagement": false,
  "leads.get": false,
  "leads.list": false,
  "leads.lookup": false,
  "leads.lookupMany": false,
  "leads.since": false,
  "leads.timeline": false,
  "lists.get": false,
  "lists.leads": false,
  "lists.list": false,
  "messages.body": false,
  "messages.byHand": false,
  "messages.byThread": false,
  "messages.list": false,
  "messages.since": false,
  native: false,
  "placementTests.list": false,
  "replies.category": false,
  "replies.list": false,
  "replies.inbox": false,
  "replies.since": false,
  "replies.unread": false,
  "senders.byCampaign": false,
  "senders.get": false,
  "senders.health": false,
  "senders.healthList": false,
  "senders.list": false,
  "senders.warmup": false,
  sequence: false,
  "sequence.subsequences": false,
  "stats.byDay": false,
  "stats.bySender": false,
  "stats.byStep": false,
  "stats.allCampaigns": false,
  "stats.campaign": false,
  "stats.workspace": false,
  tags: false,
  "webhooks.get": false,
  "webhooks.list": false,
  workspaces: false,
};

// Higher is better. Two backends behind one instance promise the lower one.
const RANK = new Map<string, number>([
  ["client", 1],
  ["derived", 1],
  ["exact", 2],
  ["false", 0],
  ["full", 2],
  ["partial", 1],
  ["sampled", 1],
  ["secret", 1],
  ["server", 2],
  ["signature", 2],
  ["true", 2],
  ["vendor", 2],
]);

const rank = (value: CapabilityValue): number => RANK.get(String(value)) ?? 0;

/** Fills every undeclared key with `false`. */
export const resolveCapabilities = (
  declared: CapabilityDeclaration = {}
): Capabilities => ({
  ...NO_CAPABILITIES,
  ...declared,
});

const weaker = <Key extends CapabilityKey>(
  left: Capabilities[Key],
  right: Capabilities[Key]
): Capabilities[Key] => (rank(right) < rank(left) ? right : left);

const narrowKey = <Key extends CapabilityKey>(
  target: Capabilities,
  key: Key,
  other: Capabilities
): void => {
  target[key] = weaker(target[key], other[key]);
};

// SAFETY: NO_CAPABILITIES is a complete Capabilities, so its keys are exactly CapabilityKey.
export const CAPABILITY_KEYS = Object.keys(NO_CAPABILITIES) as CapabilityKey[];

/**
 * What every backend can do. Used when several adapters sit behind one
 * instance, and to stop a plugin widening what the adapter declared.
 */
export const intersectCapabilities = (
  first: Capabilities,
  ...rest: readonly Capabilities[]
): Capabilities => {
  const result = { ...first };

  for (const other of rest) {
    for (const key of CAPABILITY_KEYS) {
      narrowKey(result, key, other);
    }
  }

  return result;
};

export interface CapabilityGate {
  readonly capabilities: Capabilities;
  readonly provider: string;
  /** The plugin that turned a capability off, by key. */
  readonly narrowedBy: ReadonlyMap<CapabilityKey, string>;
}

/** Throws `Unsupported` unless the capability is available. */
export const requireCapability = <Key extends CapabilityKey>(
  gate: CapabilityGate,
  key: Key,
  what: string
): Exclude<Capabilities[Key], false> => {
  const value = gate.capabilities[key];

  if (value === false) {
    const plugin = gate.narrowedBy.get(key);

    const reason =
      plugin === undefined
        ? `the ${gate.provider} adapter does not support it`
        : `the ${plugin} plugin turned it off`;

    throw new OutboundError(
      "Unsupported",
      `${what} is not available: ${reason} (${key})`,
      {
        provider: gate.provider,
      }
    );
  }

  // SAFETY: `false` was excluded by the check above.
  return value as Exclude<Capabilities[Key], false>;
};
