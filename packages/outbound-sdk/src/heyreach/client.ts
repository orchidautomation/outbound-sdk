// Request building for HeyReach. Describes each request; the request engine
// sends it. Auth is the `X-API-KEY` header. Most reads are POST with a JSON body.

import type {
  AdapterContext,
  HttpMethod,
  RawDescriptor,
  RequestSpec,
} from "../internal/adapter.ts";
import { OutboundError } from "../internal/errors.ts";
import { isJsonObject } from "../internal/json.ts";
import type { Json, JsonObject } from "../internal/json.ts";
import type { Identity } from "../internal/record.ts";
import { buildUrl } from "../internal/url.ts";
import type { QueryValue } from "../internal/url.ts";
import { BASE_URL } from "./capabilities.ts";

export interface ClientOptions {
  readonly apiKey: string;
  readonly baseUrl: string | undefined;
  readonly identity: Identity;
}

export interface HeyReachClient {
  readonly identity: Identity;
  readonly raw: RawDescriptor;
  readonly get: (
    ctx: AdapterContext,
    path: string,
    query?: Readonly<Record<string, QueryValue>>
  ) => Promise<Json>;
  readonly post: (
    ctx: AdapterContext,
    path: string,
    body: JsonObject
  ) => Promise<Json>;
  /** Narrows a response to one object, or throws a `Provider` error. */
  readonly object: (body: Json, path: string) => JsonObject;
}

// Every documented POST that only reads. Anything else sent with POST writes.
const READ_POSTS = new Set([
  "/MyNetwork/GetMyNetworkForSender",
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

// GET .../api-keys/workspaces/{workspaceId} returns every key of a workspace.
// A raw response is handed back as it is, so this read is refused.
const SECRET_GET_PATTERN = /^\/management\/organizations\/api-keys\//u;

const normalizePath = (path: string): string =>
  `/${path
    .replace(/\?.*$/u, "")
    .replace(/^\/+/u, "")
    .replace(/\/+$/u, "")}`.replace(/^\/api\/public/u, "");

export const isRead = (method: HttpMethod, path: string): boolean => {
  const normalized = normalizePath(path);

  if (method === "GET") {
    return !SECRET_GET_PATTERN.test(normalized);
  }

  return (
    method === "POST" &&
    (READ_POSTS.has(normalized) || READ_POST_PATTERN.test(normalized))
  );
};

export const createClient = (options: ClientOptions): HeyReachClient => {
  const baseUrl = options.baseUrl ?? BASE_URL;

  const authorize = (spec: RequestSpec): RequestSpec => ({
    ...spec,
    headers: { ...spec.headers, "X-API-KEY": options.apiKey },
  });

  return {
    get: async (ctx, path, query) => {
      const response = await ctx.request(
        authorize({ method: "GET", url: buildUrl(baseUrl, path, query) })
      );

      return response.body;
    },
    identity: options.identity,
    object: (body, path) => {
      if (!isJsonObject(body)) {
        throw new OutboundError(
          "Provider",
          `HeyReach returned no object for ${path}`,
          { provider: options.identity.provider }
        );
      }

      return body;
    },
    post: async (ctx, path, body) => {
      const response = await ctx.request(
        authorize({ body, method: "POST", url: buildUrl(baseUrl, path) })
      );

      return response.body;
    },
    raw: { authorize, baseUrl, isRead },
  };
};
