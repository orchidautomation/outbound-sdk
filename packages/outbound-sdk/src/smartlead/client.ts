// Request building for Smartlead. Describes each request; the request engine
// sends it. Auth is the `api_key` query parameter: Smartlead accepts the key
// nowhere else, so the key is part of every URL and must stay in `secrets`.

import type {
  HttpMethod,
  RawDescriptor,
  RequestSpec,
} from "../internal/adapter.ts";
import { createVendorClient } from "../internal/client.ts";
import type { VendorClient } from "../internal/client.ts";
import type { Identity } from "../internal/record.ts";
import { BASE_URL } from "./capabilities.ts";
import { NATIVE_READ_POSTS } from "./native.ts";

export interface ClientOptions {
  readonly apiKey: string;
  readonly baseUrl: string | undefined;
  readonly identity: Identity;
}

export type { RequestOptions } from "../internal/client.ts";

export interface SmartleadClient extends VendorClient {
  readonly identity: Identity;
  readonly raw: RawDescriptor;
}

// The reads Smartlead serves over POST: the master inbox replies, which
// `replies.list` reads, and every POST in the native catalog (the other inbox
// views, the lead search, the bulk message history, the tags of a set of
// mailboxes and the sister services' reports).
const READ_POSTS = [/^\/master-inbox\/inbox-replies$/u, ...NATIVE_READ_POSTS];

const normalizePath = (path: string): string => {
  const [withoutQuery = ""] = path.split("?");

  return `/${withoutQuery.replace(/^\/+/u, "").replace(/\/+$/u, "")}`.replace(
    /^\/api\/v1(?=\/|$)/u,
    ""
  );
};

// Reads whose response holds secrets: client API keys, a mailbox looked up by
// address (SMTP and IMAP passwords), a SmartSenders one-time password and the
// mailbox passwords of a SmartSenders order.
const SECRET_PATH =
  /^\/(?:client\/api-key|email-accounts\/fetch-email-account-details|smart-senders\/(?:auth-secret|order-details))(?:\/|$)/iu;

// GET /client/{id} returns whitelabel credentials when asked to.
const CLIENT = /^\/client\/[^/]+$/iu;

export const isSecret = (path: string, query: URLSearchParams): boolean => {
  const normalized = normalizePath(path);
  const whitelabel = query.get("includeWhitelabel");

  return (
    SECRET_PATH.test(normalized) ||
    (CLIENT.test(normalized) &&
      whitelabel !== null &&
      whitelabel.toLowerCase() !== "false")
  );
};

export const isRead = (method: HttpMethod, path: string): boolean => {
  if (method === "GET") {
    return true;
  }

  const normalized = normalizePath(path);

  return (
    method === "POST" && READ_POSTS.some((pattern) => pattern.test(normalized))
  );
};

export const createClient = (options: ClientOptions): SmartleadClient => {
  const baseUrl = options.baseUrl ?? BASE_URL;

  const authorize = (spec: RequestSpec): RequestSpec => {
    const url = new URL(spec.url);
    url.searchParams.set("api_key", options.apiKey);

    return { ...spec, url: url.toString() };
  };

  return {
    ...createVendorClient(baseUrl, authorize),
    identity: options.identity,
    raw: { authorize, baseUrl, isRead, isSecret },
  };
};
