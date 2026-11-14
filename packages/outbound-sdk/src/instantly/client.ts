// Request building for Instantly. Describes each request; the request engine
// sends it. Auth is `Authorization: Bearer <key>`.

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
  /** A sub workspace to act as, for an agency's admin workspace key. */
  readonly asWorkspace: string | undefined;
  readonly identity: Identity;
  readonly readTags: boolean;
}

export interface GetOptions {
  readonly query?: Readonly<Record<string, QueryValue>> | undefined;
  readonly lane?: string | undefined;
}

export interface InstantlyClient {
  readonly identity: Identity;
  readonly raw: RawDescriptor;
  readonly get: (
    ctx: AdapterContext,
    path: string,
    options?: GetOptions
  ) => Promise<Json>;
  readonly post: (
    ctx: AdapterContext,
    path: string,
    body: JsonObject
  ) => Promise<Json>;
  /** `false` when the caller turned the `tags` capability off. */
  readonly readTags: boolean;
  /** `get`, for an endpoint that returns one object. */
  readonly getObject: (
    ctx: AdapterContext,
    path: string,
    options?: GetOptions
  ) => Promise<JsonObject>;
}

// Instantly lists leads, reads warmup analytics, tests a mailbox's DNS records
// and looks up the tags of resources with POST. None of them changes data.
const READ_POSTS = new Set([
  "/accounts/test/vitals",
  "/accounts/warmup-analytics",
  "/custom-tags/search",
  "/leads/list",
]);

const normalizePath = (path: string): string =>
  `/${path.replace(/^\/+/u, "").replace(/\/+$/u, "")}`.replace(
    /^\/api\/v2/u,
    ""
  );

export const isRead = (method: HttpMethod, path: string): boolean =>
  method === "GET" ||
  (method === "POST" && READ_POSTS.has(normalizePath(path)));

export const createClient = (options: ClientOptions): InstantlyClient => {
  const baseUrl = options.baseUrl ?? BASE_URL;

  const authorize = (spec: RequestSpec): RequestSpec => ({
    ...spec,
    headers: {
      ...spec.headers,
      authorization: `Bearer ${options.apiKey}`,
      ...(options.asWorkspace === undefined
        ? undefined
        : { "x-as-workspace": options.asWorkspace }),
    },
  });

  const get = async (
    ctx: AdapterContext,
    path: string,
    request: GetOptions = {}
  ): Promise<Json> => {
    const response = await ctx.request(
      authorize({
        lane: request.lane,
        method: "GET",
        url: buildUrl(baseUrl, path, request.query),
      })
    );

    return response.body;
  };

  return {
    get,
    getObject: async (ctx, path, request) => {
      const body = await get(ctx, path, request);

      if (!isJsonObject(body)) {
        throw new OutboundError(
          "Provider",
          `Instantly returned no object for ${path}`,
          {
            provider: options.identity.provider,
          }
        );
      }

      return body;
    },
    identity: options.identity,
    post: async (ctx, path, body) => {
      const response = await ctx.request(
        authorize({ body, method: "POST", url: buildUrl(baseUrl, path) })
      );

      return response.body;
    },
    raw: { authorize, baseUrl, isRead },
    readTags: options.readTags,
  };
};
