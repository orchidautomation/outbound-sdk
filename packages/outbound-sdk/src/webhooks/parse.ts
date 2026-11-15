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

import { emailbisonEvents } from "../emailbison/webhooks.ts";
import { heyreachEvents } from "../heyreach/webhooks.ts";
import { instantlyEvents } from "../instantly/webhooks.ts";
import type { EventFormat, WebhookRequest } from "../internal/adapter.ts";
import { SCHEMA_VERSION } from "../internal/entities.ts";
import type { OutboundEvent } from "../internal/entities.ts";
import { OutboundError } from "../internal/errors.ts";
import { parseJson } from "../internal/json.ts";
import type { OutboundPlugin } from "../internal/outbound/plugins.ts";
import { stableId } from "../internal/sha256.ts";
import { smartleadEvents } from "../smartlead/webhooks.ts";
import { carriesSecret } from "./secret.ts";

// Checked in this order when the provider is `auto`. Each format's `detect`
// is specific enough not to claim another vendor's payload.
const FORMATS = new Map<string, EventFormat>([
  ["instantly", instantlyEvents("instantly")],
  ["smartlead", smartleadEvents("smartlead")],
  ["heyreach", heyreachEvents("heyreach")],
  ["emailbison", emailbisonEvents("emailbison")],
]);

/** The providers whose webhooks can be parsed. */
export const webhookProviders = (): string[] => [...FORMATS.keys()].toSorted();

/** Remembers which events were already handled. Supply your own for more than one process. */
export interface DedupeStore {
  /** Records the id and returns `true` when it had not been seen before. */
  readonly claim: (id: string) => Promise<boolean>;
}

/** An in-memory dedupe store that forgets its oldest ids once it is full. */
export const memoryDedupeStore = (maxIds = 10_000): DedupeStore => {
  const seen = new Set<string>();

  return {
    claim: (id) => {
      if (seen.has(id)) {
        return Promise.resolve(false);
      }

      seen.add(id);

      if (seen.size > maxIds) {
        const [oldest] = seen;

        if (oldest !== undefined) {
          seen.delete(oldest);
        }
      }

      return Promise.resolve(true);
    },
  };
};

export interface ParseOptions {
  /** A provider id, or `auto` to detect it from the payload. Name it in production. */
  readonly provider?: string | undefined;
  /**
   * The vendor's signing secret when it signs payloads; otherwise a shared
   * secret you put in the webhook URL (a path segment or `?secret=`) or in an
   * `x-webhook-secret` or `Authorization: Bearer` header. When given, a
   * request that fails the check is rejected with `Unauthorized`.
   */
  readonly secret?: string | undefined;
  /** The label of the workspace the webhook belongs to. Defaults to `default`. */
  readonly workspaceId?: string | undefined;
  /** Drops events already handled. Without it, only repeats inside one payload are dropped. */
  readonly dedupe?: DedupeStore | undefined;
  /** Plugins whose `event` hooks should run, in the same order as on the instance. */
  readonly plugins?: readonly OutboundPlugin[] | undefined;
}

const read = async (request: Request): Promise<WebhookRequest> => {
  const rawBody = await request.text();

  return {
    body: parseJson(rawBody) ?? rawBody,
    headers: request.headers,
    rawBody,
    url: request.url,
  };
};

interface Resolved {
  readonly provider: string;
  readonly format: EventFormat | undefined;
}

const resolve = (webhook: WebhookRequest, provider: string): Resolved => {
  if (provider !== "auto") {
    const format = FORMATS.get(provider);

    if (format === undefined) {
      throw new OutboundError(
        "Invalid",
        `No webhook parser for "${provider}". Known providers: ${webhookProviders().join(", ")}`
      );
    }

    return { format, provider };
  }

  const detected = [...FORMATS.entries()].find(([, format]) =>
    format.detect(webhook)
  );

  return detected === undefined
    ? { format: undefined, provider: "unknown" }
    : { format: detected[1], provider: detected[0] };
};

const authenticate = (
  webhook: WebhookRequest,
  resolved: Resolved,
  secret: string | undefined
): void => {
  if (secret === undefined) {
    return;
  }

  const signed = resolved.format?.verify;

  const trusted =
    signed === undefined
      ? carriesSecret(webhook.url, webhook.headers, secret)
      : signed(webhook, secret);

  if (!trusted) {
    throw new OutboundError(
      "Unauthorized",
      signed === undefined
        ? "The webhook does not carry the shared secret"
        : "The webhook signature does not match",
      { provider: resolved.provider }
    );
  }
};

// A payload no parser recognises is still returned, so it can be reported.
const unknownEvent = (
  webhook: WebhookRequest,
  workspaceId: string
): OutboundEvent => ({
  campaignRef: null,
  data: {},
  id: stableId("unknown", webhook.rawBody),
  leadRef: null,
  messageRef: null,
  occurredAt: null,
  provider: "unknown",
  raw: webhook.body,
  schemaVersion: SCHEMA_VERSION,
  senderRef: null,
  type: "unknown",
  workspaceId,
});

/** Runs every plugin's `event` hook, innermost first. `null` drops the event. */
const applyEventHooks = (
  plugins: readonly OutboundPlugin[],
  event: OutboundEvent
): OutboundEvent | null => {
  let current: OutboundEvent | null = event;

  for (const plugin of plugins.toReversed()) {
    if (current === null) {
      return null;
    }

    current = plugin.event === undefined ? current : plugin.event(current);
  }

  return current;
};

/** `true` when the request is authentic for the provider and secret. Never throws for a bad signature. */
export const verify = async (
  request: Request,
  options: { readonly provider?: string | undefined; readonly secret: string }
): Promise<boolean> => {
  const webhook = await read(request.clone());

  try {
    authenticate(
      webhook,
      resolve(webhook, options.provider ?? "auto"),
      options.secret
    );

    return true;
  } catch (error) {
    if (OutboundError.is(error) && error.code === "Unauthorized") {
      return false;
    }

    throw error;
  }
};

/**
 * Parses a webhook into events. Unknown events are returned with
 * `type: "unknown"` and never dropped; redelivered events are dropped when a
 * dedupe store is given.
 */
export const parse = async (
  request: Request,
  options: ParseOptions = {}
): Promise<OutboundEvent[]> => {
  const webhook = await read(request);
  const workspaceId = options.workspaceId ?? "default";
  const resolved = resolve(webhook, options.provider ?? "auto");
  authenticate(webhook, resolved, options.secret);

  const parsed = resolved.format?.parse(webhook, workspaceId) ?? [
    unknownEvent(webhook, workspaceId),
  ];

  const seen = new Set<string>();

  const fresh = parsed.flatMap((event) => {
    const rewritten = applyEventHooks(options.plugins ?? [], event);

    if (rewritten === null || seen.has(rewritten.id)) {
      return [];
    }

    seen.add(rewritten.id);

    return [rewritten];
  });

  const { dedupe } = options;

  if (dedupe === undefined) {
    return fresh;
  }

  const claimed = await Promise.all(
    fresh.map((event) => dedupe.claim(event.id))
  );

  return fresh.filter((_event, index) => claimed[index] === true);
};

/** How to point a vendor's webhooks at your endpoint. The SDK is read-only and never registers one. */
export const setupInstructions = (provider: string): string => {
  const instructions = new Map([
    [
      "smartlead",
      "Smartlead: Settings > Webhooks > Add webhook, per account, client or campaign (only one fires per event; the account-level one wins). Turn on signing for the webhook and pass its whsec_ secret as `secret`: the SDK then checks the Standard Webhooks signature and rejects anything older than five minutes. An unsigned Smartlead webhook fails verification.",
    ],
    [
      "heyreach",
      "HeyReach: Integrations > Webhooks > Create webhook, one per event type. HeyReach does not sign payloads, so put a secret in the URL (https://your.app/hooks/<secret>) or add it as a custom header named x-webhook-secret, and pass the same value as `secret`.",
    ],
    [
      "emailbison",
      "EmailBison: Settings > Webhooks > New Webhook URL, per workspace. The SDK cannot check EmailBison's signature, whose scheme is undocumented, so put a secret in the URL (https://your.app/hooks/<secret>) and pass the same value as `secret`.",
    ],
    [
      "instantly",
      "Instantly: Settings > Integrations > Webhooks > Add webhook (Hyper Growth plan or above). Instantly does not sign payloads, so put a secret in the URL (https://your.app/hooks/<secret>) or add it as a custom header named x-webhook-secret, and pass the same value as `secret`.",
    ],
  ]);

  const found = instructions.get(provider);

  if (found === undefined) {
    throw new OutboundError(
      "Invalid",
      `No webhook setup instructions for "${provider}"`
    );
  }

  return found;
};
