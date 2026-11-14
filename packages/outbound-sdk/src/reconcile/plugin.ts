// outbound-sdk/reconcile: webhooks arrive late, twice or not at all, and list
// calls stop returning deleted records. This compares what you received with
// what the vendor lists, and reports the difference. A mismatch is reported,
// never hidden or silently repaired.

import type { OperationOptions } from "../internal/engine/engine.ts";
import type { Message, OutboundEvent } from "../internal/entities.ts";
import type { OutboundApi } from "../internal/outbound/api.ts";
import type { OutboundPlugin } from "../internal/outbound/plugins.ts";

export interface ReceivedEvent {
  readonly event: OutboundEvent;
  /** When your endpoint received it, ISO 8601 UTC. Needed to detect late delivery. */
  readonly receivedAt?: string | undefined;
}

export interface EventCheck extends OperationOptions {
  /** The events your webhook endpoint received in the window. */
  readonly events: readonly (OutboundEvent | ReceivedEvent)[];
  /** The window to compare, ISO 8601 UTC. */
  readonly since: string;
  readonly until?: string | undefined;
  readonly campaignId?: string | undefined;
  /** An event received this long after it happened counts as late. Defaults to 5 minutes. */
  readonly lateAfterMinutes?: number | undefined;
}

export interface EventReport {
  /** Events that name a message and could be compared. */
  readonly checked: number;
  readonly matched: number;
  /** Events naming a message the vendor does not list. */
  readonly unmatchedEvents: readonly OutboundEvent[];
  /** Messages the vendor lists that no event announced: a webhook never arrived. */
  readonly missingEvents: readonly Message[];
  readonly late: readonly {
    readonly event: OutboundEvent;
    readonly delayMs: number;
  }[];
  /** Events with no message ref, which cannot be compared. */
  readonly uncheckable: number;
}

export interface DeletionCheck extends OperationOptions {
  readonly collection: "campaigns" | "leads" | "senders";
  /** The refs you hold from an earlier sync. */
  readonly known: Iterable<string>;
  readonly campaignId?: string | undefined;
}

export interface DeletionReport {
  /** Refs you hold that the vendor no longer lists. */
  readonly deleted: readonly string[];
  /** Refs the vendor lists that you do not hold yet. */
  readonly added: readonly string[];
  readonly listed: number;
}

export interface ReconcileExtension {
  readonly reconcile: {
    readonly events: (check: EventCheck) => Promise<EventReport>;
    /** Lists the whole collection, so it costs as much as a full sync. */
    readonly deletions: (check: DeletionCheck) => Promise<DeletionReport>;
  };
}

const MESSAGE_EVENTS = new Set([
  "message.sent",
  "reply.received",
  "linkedin.message_sent",
  "linkedin.message_received",
]);

const unwrap = (entry: OutboundEvent | ReceivedEvent): ReceivedEvent =>
  "event" in entry ? entry : { event: entry };

const lateEvents = (
  received: readonly ReceivedEvent[],
  lateAfterMs: number
): { event: OutboundEvent; delayMs: number }[] =>
  received.flatMap(({ event, receivedAt }) => {
    if (receivedAt === undefined || event.occurredAt === null) {
      return [];
    }

    const delayMs = Date.parse(receivedAt) - Date.parse(event.occurredAt);

    return delayMs > lateAfterMs ? [{ delayMs, event }] : [];
  });

const checkEvents = async (
  outbound: OutboundApi,
  check: EventCheck
): Promise<EventReport> => {
  const received = check.events.map(unwrap);

  const comparable = received.filter(
    ({ event }) => MESSAGE_EVENTS.has(event.type) && event.messageRef !== null
  );

  const listed = await outbound.messages
    .listAll({
      campaignId: check.campaignId,
      deadline: check.deadline,
      maxRequests: check.maxRequests,
      signal: check.signal,
      since: check.since,
      until: check.until,
    })
    .toArray();

  const listedRefs = new Set(listed.map((message) => message.ref));
  const announced = new Set(comparable.map(({ event }) => event.messageRef));

  const unmatchedEvents = comparable.flatMap(({ event }) =>
    event.messageRef !== null && !listedRefs.has(event.messageRef)
      ? [event]
      : []
  );

  return {
    checked: comparable.length,
    late: lateEvents(received, (check.lateAfterMinutes ?? 5) * 60_000),
    matched: comparable.length - unmatchedEvents.length,
    missingEvents: listed.filter((message) => !announced.has(message.ref)),
    uncheckable: received.length - comparable.length,
    unmatchedEvents,
  };
};

const checkDeletions = async (
  outbound: OutboundApi,
  check: DeletionCheck
): Promise<DeletionReport> => {
  const { campaignId } = check;

  const walks = {
    campaigns: () => outbound.campaigns.listAll(check),
    leads: () => outbound.leads.listAll({ ...check, campaignId }),
    senders: () => outbound.senders.listAll({ ...check, campaignId }),
  };

  const listed = new Set<string>();

  for await (const record of walks[check.collection]()) {
    listed.add(record.ref);
  }

  const known = new Set(check.known);

  return {
    added: [...listed].filter((ref) => !known.has(ref)),
    deleted: [...known].filter((ref) => !listed.has(ref)),
    listed: listed.size,
  };
};

/** Compares received webhooks and held records with what the vendor lists. */
export const reconcile = (): OutboundPlugin<ReconcileExtension> => ({
  extend: (outbound) => ({
    reconcile: {
      deletions: (check) => checkDeletions(outbound, check),
      events: (check) => checkEvents(outbound, check),
    },
  }),
  name: "reconcile",
});
