import { DatabaseSync } from "node:sqlite";

import type { ReceivedEvent } from "outbound-sdk/reconcile";

import { sqliteDedupe } from "./dedupe-store.ts";
import { createHandler } from "./handler.ts";
import { payload, post, SECRET } from "./payloads.ts";

const sent = payload("instantly", "email_sent");
const reply = payload("instantly", "reply_received");
const opened = payload("instantly", "email_opened");

// What arrives at the endpoint, in order, and when. Both messages happened
// at 00:36:06, so the reply's webhook is 34 minutes late.
const deliveries = () => [
  { at: "2026-11-14T00:36:10.000Z", name: "email_sent", request: post(sent) },
  {
    at: "2026-11-14T01:10:06.650Z",
    name: "reply_received",
    request: post(reply),
  },
  {
    at: "2026-11-14T01:10:09.000Z",
    name: "reply_received again",
    request: post(reply),
  },
  {
    at: "2026-11-14T01:15:00.000Z",
    name: "email_opened",
    request: post(opened),
  },
  {
    at: "2026-11-14T01:20:00.000Z",
    name: "email_sent, wrong secret",
    request: post(sent, "not-the-secret"),
  },
];

/** Sends every delivery through the handler. Returns what it kept. */
export const receive = async (): Promise<{
  readonly log: string[];
  readonly received: ReceivedEvent[];
}> => {
  const received: ReceivedEvent[] = [];
  const log: string[] = [];
  let clock = "";

  const handle = createHandler({
    dedupe: sqliteDedupe(new DatabaseSync(":memory:")),
    now: () => clock,
    save: (entry) => {
      received.push(entry);
    },
    secret: SECRET,
  });

  for (const delivery of deliveries()) {
    const before = received.length;

    clock = delivery.at;
    // oxlint-disable-next-line no-await-in-loop -- deliveries arrive one after another.
    const response = await handle(delivery.request);

    const kept = received
      .slice(before)
      .map(({ event }) => event.type)
      .join(", ");

    log.push(
      `${delivery.name}: ${response.status}, kept ${kept === "" ? "nothing" : kept}`
    );
  }

  return { log, received };
};
