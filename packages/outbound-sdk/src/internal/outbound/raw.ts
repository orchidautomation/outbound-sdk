// outbound.raw: the vendor's own API for anything not normalized yet. The SDK
// promises read-only, so a request that is not a known read is refused unless
// the instance was created with `allowWrites: true`.

import type { HttpMethod } from "../adapter.ts";
import { OutboundError } from "../errors.ts";
import type { Json } from "../json.ts";
import { buildUrl } from "../url.ts";
import type { RawClient, RawRequestOptions } from "./api.ts";
import { perform } from "./core.ts";
import type { Core } from "./core.ts";

export const makeRawClient = (core: Core): RawClient => {
  const { adapter } = core;

  const request = (
    method: HttpMethod,
    path: string,
    options: RawRequestOptions = {}
  ): Promise<Json> => {
    if (adapter.members !== undefined) {
      throw new OutboundError(
        "Unsupported",
        "raw is not available on a combined instance. Use outbound.workspace(id).raw",
        { provider: adapter.name }
      );
    }

    if (!core.allowWrites && !adapter.raw.isRead(method, path)) {
      throw new OutboundError(
        "Unsupported",
        `${method} ${path} is not a known read on ${adapter.name}. The SDK is read-only; pass allowWrites: true to createOutbound to permit it`,
        { provider: adapter.name }
      );
    }

    return perform(core, "raw", options, async (state) => {
      const spec = adapter.raw.authorize({
        body: options.body,
        lane: options.lane,
        method,
        url: buildUrl(adapter.raw.baseUrl, path, options.query),
      });

      const response = await core.engine
        .contextFor(adapter, state)
        .request(spec);

      return response.body;
    });
  };

  return {
    get: (path, options) => request("GET", path, options),
    provider: adapter.name,
    request,
  };
};
