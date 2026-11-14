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
import type { NativeRead } from "../internal/native.ts";
import type { Identity } from "../internal/record.ts";
import { buildUrl } from "../internal/url.ts";
import type { QueryValue } from "../internal/url.ts";
import { BASE_URL } from "./capabilities.ts";
import { NATIVE } from "./native.ts";

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

// Instantly lists leads, reads warmup analytics and tests a mailbox's DNS
// records with POST. None of them changes data. Instantly lets a key with a
// read scope call each one, and each POST in the native catalog.
const READ_POSTS = [
  "/accounts/test/vitals",
  "/accounts/warmup-analytics",
  "/leads/list",
];

const normalizePath = (path: string): string =>
  `/${path.replace(/^\/+/u, "").replace(/\/+$/u, "")}`.replace(
    /^\/api\/v2/u,
    ""
  );

/** Matches a catalog path, where `{name}` stands for one path segment. */
const pattern = (path: string): RegExp =>
  new RegExp(
    `^${path
      .split("/")
      .map((part) =>
        part.startsWith("{") ? "[^/]+" : part.replaceAll(".", String.raw`\.`)
      )
      .join("/")}$`,
    "u"
  );

const READ_POST_PATTERNS = [
  ...READ_POSTS,
  ...Object.values<NativeRead>(NATIVE).flatMap((read) =>
    read.method === "POST" ? [read.path] : []
  ),
].map((path) => pattern(path));

export const isRead = (method: HttpMethod, path: string): boolean => {
  if (method !== "POST") {
    return method === "GET";
  }

  const normalized = normalizePath(path);

  return READ_POST_PATTERNS.some((expression) => expression.test(normalized));
};

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
