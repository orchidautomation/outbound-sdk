// Request building for HeyReach. Describes each request; the request engine
// sends it. Auth is the `X-API-KEY` header. Most reads are POST with a JSON body.

import type {
  HttpMethod,
  RawDescriptor,
  RequestSpec,
} from "../internal/adapter.ts";
import { createVendorClient } from "../internal/client.ts";
import type { VendorClient } from "../internal/client.ts";
import { requireObject } from "../internal/errors.ts";
import type { Json, JsonObject } from "../internal/json.ts";
import type { Identity } from "../internal/record.ts";
import { BASE_URL } from "./capabilities.ts";

export interface ClientOptions {
  readonly apiKey: string;
  readonly baseUrl: string | undefined;
  readonly identity: Identity;
}

export interface HeyReachClient extends VendorClient {
  readonly identity: Identity;
  readonly raw: RawDescriptor;
  /** Narrows a response to one object, or throws a `Provider` error. */
  readonly object: (body: Json, path: string) => JsonObject;
}

// Every documented POST that only reads. Anything else sent with POST writes.
const READ_POSTS = new Set([
  "/MyNetwork/GetMyNetworkForSender",
  "/MyNetwork/IsConnection",
  "/blacklist/GetCompanies",
  "/blacklist/GetLeads",
  "/campaign/GetAll",
  "/campaign/GetCampaignsForLead",
  "/campaign/GetLeadsFromCampaign",
  "/inbox/GetConversationsV2",
  "/inbox/GetConversationsV3",
  "/lead/GetLead",
  "/lead/GetTags",
  "/li_account/GetAll",
  "/list/GetAll",
  "/list/GetCompaniesFromList",
  "/list/GetLeadsFromList",
  "/list/GetListsForLead",
  "/management/organizations/linkedin-accounts",
  "/management/organizations/users",
  "/stats/GetOverallStats",
  "/stats/GetOverallStatsByCampaign",
  "/webhooks/GetAllWebhooks",
]);

// POST /management/organizations/users/workspaces/{workspaceId} lists users.
const READ_POST_PATTERN =
  /^\/management\/organizations\/users\/workspaces\/[^/]+$/u;

// GET .../api-keys/workspaces/{workspaceId} returns every key of a workspace,
// and GET /li_account/GetAccountProxy/{accountId} returns a custom proxy's
// password. A raw response is handed back as it is, so both reads are refused.
const SECRET_GET_PATTERN =
  /^\/(?:management\/organizations\/api-keys|li_account\/GetAccountProxy)(?:\/|$)/iu;

// A webhook's custom headers can hold a shared secret. GET
// /webhooks/GetWebhookById returns them only when asked, so every request to
// it, normalized, native or raw, asks for them to be left out.
const WEBHOOK_BY_ID = /\/webhooks\/GetWebhookById\/?$/iu;

const withoutWebhookHeaders = (spec: RequestSpec): RequestSpec => {
  const url = new URL(spec.url);

  if (!WEBHOOK_BY_ID.test(url.pathname)) {
    return spec;
  }

  url.searchParams.set("includeCustomHeaders", "false");

  return { ...spec, url: url.toString() };
};

const normalizePath = (path: string): string =>
  `/${path
    .replace(/\?.*$/u, "")
    .replace(/^\/+/u, "")
    .replace(/\/+$/u, "")}`.replace(/^\/api\/public/u, "");

export const isSecret = (path: string): boolean =>
  SECRET_GET_PATTERN.test(normalizePath(path));

export const isRead = (method: HttpMethod, path: string): boolean => {
  const normalized = normalizePath(path);

  if (method === "GET") {
    return !isSecret(normalized);
  }

  return (
    method === "POST" &&
    (READ_POSTS.has(normalized) || READ_POST_PATTERN.test(normalized))
  );
};

export const createClient = (options: ClientOptions): HeyReachClient => {
  const baseUrl = options.baseUrl ?? BASE_URL;

  const authorize = (spec: RequestSpec): RequestSpec => ({
    ...withoutWebhookHeaders(spec),
    headers: { ...spec.headers, "X-API-KEY": options.apiKey },
  });

  return {
    ...createVendorClient(baseUrl, authorize),
    identity: options.identity,
    object: (body, path) =>
      requireObject(
        body,
        options.identity.provider,
        `HeyReach returned no object for ${path}`
      ),
    raw: { authorize, baseUrl, isRead, isSecret },
  };
};
