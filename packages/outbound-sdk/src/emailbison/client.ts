// Request building for EmailBison. Describes each request; the request engine
// sends it. Auth is `Authorization: Bearer <key>`. Every answer is
// `{ data: ... }`, and a list adds `links` and `meta` for its pages.

import type {
  AdapterContext,
  HttpMethod,
  RawDescriptor,
  RequestSpec,
} from "../internal/adapter.ts";
import { createVendorClient } from "../internal/client.ts";
import type { RequestOptions, VendorClient } from "../internal/client.ts";
import { requireObject } from "../internal/errors.ts";
import { count, field, isString, objects, text } from "../internal/json.ts";
import type { Json, JsonObject } from "../internal/json.ts";
import { listIn } from "../internal/lists.ts";
import type { RawPage } from "../internal/page.ts";
import type { Identity } from "../internal/record.ts";
import { BASE_URL } from "./capabilities.ts";

export interface ClientOptions {
  readonly apiKey: string;
  readonly baseUrl: string | undefined;
  readonly identity: Identity;
}

export interface EmailBisonClient extends VendorClient {
  readonly identity: Identity;
  readonly raw: RawDescriptor;
  /** `data` of an answer that must be one object, or a `Provider` error. */
  readonly one: (body: Json, path: string) => JsonObject;
  /** `data` of an answer that must be a list, or a `Provider` error. */
  readonly rows: (body: Json, path: string) => JsonObject[];
  /** One page of a list, and where the next one starts. */
  readonly page: (
    ctx: AdapterContext,
    path: string,
    next: Json | undefined,
    options?: PageOptions
  ) => Promise<RawPage>;
}

export interface PageOptions extends RequestOptions {
  /** The reference documents cursor pagination for this list. */
  readonly cursor?: boolean | undefined;
}

// The one POST that only reads: a campaign's stats between two dates.
const READ_POST = /^\/api\/campaigns\/[^/]+\/stats$/u;

// Reads whose answer holds a secret: a mailbox's OAuth access token, and the
// workspaces, which carry the webhook signing secret. The workspace stats and
// inbox settings carry neither.
const SECRET_PATH =
  /^\/api\/(?:sender-emails\/[^/]+\/oauth-access-token|workspaces(?:\/v1\.1)?(?:\/(?!stats$|line-area-chart-stats$|master-inbox-settings$)[^/]+)?)$/iu;

const normalizePath = (path: string): string => {
  const [withoutQuery = ""] = path.split("?");

  return `/${withoutQuery.replace(/^\/+/u, "").replace(/\/+$/u, "")}`;
};

export const isSecret = (path: string): boolean =>
  SECRET_PATH.test(normalizePath(path));

export const isRead = (method: HttpMethod, path: string): boolean =>
  method === "GET" ||
  (method === "POST" && READ_POST.test(normalizePath(path)));

/** The keys of a vendor payload that hold a secret, at any depth. */
export const SECRET_KEYS = /secret|token|password/iu;

// Where the next page starts. `next_cursor` continues a cursor list; a page
// below `last_page` continues a numbered one. Anything else is the last page.
const nextOf = (body: Json): Json | undefined => {
  const meta = field(body, "meta");
  const cursor = field(meta, "next_cursor");

  if (isString(cursor) && cursor !== "") {
    return { cursor };
  }

  const current = count(field(meta, "current_page"));
  const last = count(field(meta, "last_page"));

  return current !== null && last !== null && current < last
    ? { page: current + 1 }
    : undefined;
};

/** What a `next` value asks the vendor for. */
const pageQuery = (next: Json | undefined, cursor: boolean) => ({
  cursor: text(field(next, "cursor")) ?? undefined,
  page: count(field(next, "page")) ?? undefined,
  pagination_type: cursor ? "cursor" : undefined,
});

export const createClient = (options: ClientOptions): EmailBisonClient => {
  const baseUrl = (options.baseUrl ?? BASE_URL).replace(/\/+$/u, "");
  const { provider } = options.identity;

  const authorize = (spec: RequestSpec): RequestSpec => ({
    ...spec,
    headers: {
      ...spec.headers,
      Accept: "application/json",
      Authorization: `Bearer ${options.apiKey}`,
    },
  });

  const vendor = createVendorClient(baseUrl, authorize);

  const rows = (body: Json, path: string): JsonObject[] =>
    objects(
      listIn(body, { key: "data", path, provider, vendor: "EmailBison" })
    );

  return {
    ...vendor,
    identity: options.identity,
    one: (body, path) =>
      requireObject(
        field(body, "data"),
        provider,
        `EmailBison returned no object for ${path}`
      ),
    page: async (ctx, path, next, pageOptions = {}) => {
      const body = await vendor.get(ctx, path, {
        lane: pageOptions.lane,
        query: {
          ...pageOptions.query,
          ...pageQuery(next, pageOptions.cursor === true),
        },
      });

      return { items: rows(body, path), next: nextOf(body) };
    },
    raw: { authorize, baseUrl, isRead, isSecret },
    rows,
  };
};
