import type { ReceivedEvent } from "outbound-sdk/reconcile";
import { parse, verify } from "outbound-sdk/webhooks";
import type { DedupeStore } from "outbound-sdk/webhooks";

export interface HandlerOptions {
  readonly secret: string;
  readonly dedupe: DedupeStore;
  /** Keeps one event. Make it durable: reconcile reads these back later. */
  readonly save: (received: ReceivedEvent) => Promise<void> | void;
  /** The clock, ISO 8601 UTC. */
  readonly now: () => string;
}

/** A webhook endpoint for one Instantly workspace, as a fetch-style handler. */
export const createHandler =
  (options: HandlerOptions) =>
  async (request: Request): Promise<Response> => {
    // `verify` answers true or false and leaves the body readable.
    const trusted = await verify(request, {
      provider: "instantly",
      secret: options.secret,
    });

    if (!trusted) {
      return new Response(null, { status: 401 });
    }

    // An event already claimed in the dedupe store is not returned again.
    const events = await parse(request, {
      dedupe: options.dedupe,
      provider: "instantly",
      workspaceId: "acme",
    });

    for (const event of events) {
      // oxlint-disable-next-line no-await-in-loop -- events are saved in the order they arrived.
      await options.save({ event, receivedAt: options.now() });
    }

    return new Response(null, { status: 204 });
  };
