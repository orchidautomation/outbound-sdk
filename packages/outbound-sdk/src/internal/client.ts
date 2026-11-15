// The two requests every adapter makes, built once. A vendor differs in where
// its key goes, not in how a GET or a POST is described, so an adapter gives
// its base URL and its `authorize` and adds only what is its own.

import type { AdapterContext, RequestSpec } from "./adapter.ts";
import type { Json, JsonObject } from "./json.ts";
import { buildUrl } from "./url.ts";
import type { QueryValue } from "./url.ts";

export interface RequestOptions {
  readonly query?: Readonly<Record<string, QueryValue>> | undefined;
  /** A rate lane declared in the adapter's limits. */
  readonly lane?: string | undefined;
}

export interface VendorClient {
  readonly get: (
    ctx: AdapterContext,
    path: string,
    options?: RequestOptions
  ) => Promise<Json>;
  /** Only for the reads a vendor serves over POST. */
  readonly post: (
    ctx: AdapterContext,
    path: string,
    body: JsonObject,
    options?: RequestOptions
  ) => Promise<Json>;
}

/** `get` and `post` for one vendor: every request is authorized and goes through `ctx.request`. */
export const createVendorClient = (
  baseUrl: string,
  authorize: (spec: RequestSpec) => RequestSpec
): VendorClient => ({
  get: async (ctx, path, options = {}) => {
    const response = await ctx.request(
      authorize({
        lane: options.lane,
        method: "GET",
        url: buildUrl(baseUrl, path, options.query),
      })
    );

    return response.body;
  },
  post: async (ctx, path, body, options = {}) => {
    const response = await ctx.request(
      authorize({
        body,
        lane: options.lane,
        method: "POST",
        url: buildUrl(baseUrl, path, options.query),
      })
    );

    return response.body;
  },
});
