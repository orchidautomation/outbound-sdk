// outbound-sdk/webhooks: turns any supported vendor's webhook into
// OutboundEvent[].
//
//   export async function POST(request: Request) {
//     const events = await parse(request, { provider: "instantly", secret: env.WEBHOOK_SECRET });
//     return new Response(null, { status: 204 });
//   }
//
// Events are hints: a webhook can arrive late, twice or not at all. Treat
// `event.id` as the idempotency key and reconcile against list calls.

export {
  memoryDedupeStore,
  parse,
  setupInstructions,
  verify,
  webhookProviders,
} from "./parse.ts";

export type { DedupeStore, ParseOptions } from "./parse.ts";

export { carriesSecret, timingSafeEqual } from "./secret.ts";
