// The webhook events an endpoint stored during the week, as
// `parse()` from outbound-sdk/webhooks returns them, each with the time the
// endpoint received it. Made up, to match the seed.
import { SCHEMA_VERSION } from "outbound-sdk";
import type { EventType, OutboundEvent } from "outbound-sdk";
import type { ReceivedEvent } from "outbound-sdk/reconcile";

const event = (
  id: string,
  type: EventType,
  messageId: string | null,
  occurredAt: string
): OutboundEvent => ({
  campaignRef: null,
  data: {},
  id,
  leadRef: null,
  messageRef: messageId === null ? null : `memory:agency:${messageId}`,
  occurredAt,
  provider: "memory",
  raw: null,
  schemaVersion: SCHEMA_VERSION,
  senderRef: null,
  type,
  workspaceId: "agency",
});

export const received: ReceivedEvent[] = [
  // Arrived two seconds after the send.
  {
    event: event("evt_1", "message.sent", "msg_1", "2026-11-10T10:00:00.000Z"),
    receivedAt: "2026-11-10T10:00:02.000Z",
  },
  // Arrived 20 minutes after the reply.
  {
    event: event(
      "evt_2",
      "reply.received",
      "msg_2",
      "2026-11-11T08:30:00.000Z"
    ),
    receivedAt: "2026-11-11T08:50:00.000Z",
  },
  // Names a message the vendor does not list.
  {
    event: event("evt_3", "message.sent", "msg_9", "2026-11-12T09:00:00.000Z"),
    receivedAt: "2026-11-12T09:00:01.000Z",
  },
  // Not about a message, so there is nothing to compare it with.
  {
    event: event(
      "evt_4",
      "lead.unsubscribed",
      null,
      "2026-11-12T11:00:00.000Z"
    ),
    receivedAt: "2026-11-12T11:00:01.000Z",
  },
  // No webhook arrived for msg_3, sent on 2026-11-12.
];
