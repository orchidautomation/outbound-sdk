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
  /** A campaign's steps and variants. */
  sequence: boolean;
  "senders.list": boolean;
  "senders.get": boolean;
  /** List the senders attached to one campaign. */
  "senders.byCampaign": boolean;
  "senders.warmup": boolean;
  "leads.list": boolean;
  "leads.get": boolean;
  /** List the leads of one campaign. */
  "leads.byCampaign": boolean;
  "leads.since": FilterGrade;
  /** Every message for one lead, in order. */
  "leads.timeline": boolean;
  "messages.list": boolean;
  /** Whether message bodies are returned: all, some, or none. */
  "messages.body": "full" | "sampled" | false;
  "messages.since": FilterGrade;
  "replies.list": boolean;
  /** Reply categories come from the vendor, or are not available. */
  "replies.category": "vendor" | false;
  "replies.since": FilterGrade;
  "stats.workspace": StatGrade;
  "stats.campaign": StatGrade;
  "stats.byDay": StatGrade;
  "stats.byStep": StatGrade;
  "stats.bySender": StatGrade;
  workspaces: boolean;
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
  "campaigns.status": false,
  deletionDetection: false,
  "events.parse": false,
  "events.verify": false,
  "leads.byCampaign": false,
  "leads.get": false,
  "leads.list": false,
  "leads.since": false,
  "leads.timeline": false,
  "messages.body": false,
  "messages.list": false,
  "messages.since": false,
  "replies.category": false,
  "replies.list": false,
  "replies.since": false,
  "senders.byCampaign": false,
  "senders.get": false,
  "senders.list": false,
  "senders.warmup": false,
  sequence: false,
  "stats.byDay": false,
  "stats.bySender": false,
  "stats.byStep": false,
  "stats.campaign": false,
  "stats.workspace": false,
  workspaces: false,
};

// Higher is better. Two backends behind one instance promise the lower one.
const RANK = new Map<string, number>([
  ["client", 1],
  ["derived", 1],
  ["exact", 2],
  ["false", 0],
  ["full", 2],
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
