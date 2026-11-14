import process from "node:process";

import { OutboundError } from "outbound-sdk";
import { memoryDedupeStore, parse } from "outbound-sdk/webhooks";

import { payload, post } from "../webhooks-events/fixtures.ts";

// One process only. Use a store of your own when more than one instance runs.
const dedupe = memoryDedupeStore();

/** A route handler in the web-standard shape: Next.js, Hono, Workers, Bun. */
export const POST = async (request: Request): Promise<Response> => {
  const secret = process.env.WEBHOOK_SECRET;

  // Without a secret `parse` checks nothing, so refuse to run without one.
  if (secret === undefined || secret === "") {
    return new Response(null, { status: 500 });
  }

  try {
    const events = await parse(request, {
      dedupe,
      provider: "instantly",
      secret,
    });

    for (const event of events) {
      // Hand each event to your own code. An event is a hint: read the
      // record back with the SDK before acting on it.
      console.log(event.type, event.campaignRef, event.data.leadEmail);
    }

    return new Response(null, { status: 204 });
  } catch (error) {
    if (OutboundError.is(error) && error.code === "Unauthorized") {
      return new Response(null, { status: 401 });
    }

    throw error;
  }
};

// Called here with the documented payload, to show it runs.
process.env.WEBHOOK_SECRET = "example-shared-secret";

const body = payload("instantly", "webhook.reply_received.json");
const url = "https://your.app/hooks/example-shared-secret";

const first = await POST(post(body, url));
const redelivery = await POST(post(body, url));
const unsigned = await POST(post(body));

console.log(first.status);

console.log(redelivery.status, "(redelivery: no event)");

console.log(unsigned.status, "(no secret in the request)");
