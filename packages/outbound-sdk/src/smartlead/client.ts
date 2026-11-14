// Request building for Smartlead. Describes each request; the request engine
// sends it. Auth is the `api_key` query parameter: Smartlead accepts the key
// nowhere else, so the key is part of every URL and must stay in `secrets`.

import type {
  AdapterContext,
  HttpMethod,
  RawDescriptor,
  RequestSpec,
} from "../internal/adapter.ts";
import type { Json, JsonObject } from "../internal/json.ts";
import type { Identity } from "../internal/record.ts";
import { buildUrl } from "../internal/url.ts";
import type { QueryValue } from "../internal/url.ts";
import { BASE_URL } from "./capabilities.ts";
import { NATIVE_READ_POSTS } from "./native.ts";

export interface ClientOptions {
  readonly apiKey: string;
  readonly baseUrl: string | undefined;
  readonly identity: Identity;
}

export interface RequestOptions {
  readonly query?: Readonly<Record<string, QueryValue>> | undefined;
  readonly lane?: string | undefined;
}

export interface SmartleadClient {
  readonly identity: Identity;
  readonly raw: RawDescriptor;
  readonly get: (
    ctx: AdapterContext,
    path: string,
    options?: RequestOptions
  ) => Promise<Json>;
  /** Only for the reads Smartlead serves over POST; see `READ_POSTS`. */
  readonly post: (
    ctx: AdapterContext,
    path: string,
    body: JsonObject,
    options?: RequestOptions
  ) => Promise<Json>;
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
    get: async (ctx, path, request = {}) => {
      const response = await ctx.request(
        authorize({
          lane: request.lane,
          method: "GET",
          url: buildUrl(baseUrl, path, request.query),
        })
      );

      return response.body;
    },
    identity: options.identity,
    post: async (ctx, path, body, request = {}) => {
      const response = await ctx.request(
        authorize({
          body,
          lane: request.lane,
          method: "POST",
          url: buildUrl(baseUrl, path, request.query),
        })
      );

      return response.body;
    },
    raw: { authorize, baseUrl, isRead },
  };
};
