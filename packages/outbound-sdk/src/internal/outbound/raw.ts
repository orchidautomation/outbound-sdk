// outbound.raw: the vendor's own API for anything not normalized yet. The SDK
// promises read-only, so a request that is not a known read is refused unless
// the instance was created with `allowWrites: true`. A read whose response
// holds secrets is refused either way. So is every request once a plugin has
// turned `native` off: raw returns the same untouched payload a native read
// does, so what a plugin could not let through there cannot go through here.

import type { HttpMethod } from "../adapter.ts";
import { OutboundError } from "../errors.ts";
import type { Json } from "../json.ts";
import { buildUrl } from "../url.ts";
import type { RawClient, RawRequestOptions } from "./api.ts";
import { perform } from "./core.ts";
import type { Core } from "./core.ts";

// An encoded slash, backslash or dot can name a different endpoint to the
// vendor than the one the path was checked as.
const ENCODED_SEPARATOR = /%(?:2f|5c|2e)|\\/iu;

interface Target {
  /** The URL that will be sent. */
  readonly url: string;
  /** Its path relative to the adapter's base URL, as the rules are written. */
  readonly path: string;
  readonly query: URLSearchParams;
}

const refuse = (core: Core, message: string): OutboundError =>
  new OutboundError("Unsupported", message, {
    provider: core.adapter.name,
  });

/**
 * Builds the URL first and reads the path back from it, so the rules judge
 * what is sent and not what was typed: the URL parser resolves `.` and `..`,
 * repeated slashes are collapsed, and a path that leaves the API or hides a
 * separator in percent-encoding is refused.
 */
const resolve = (
  core: Core,
  path: string,
  query: RawRequestOptions["query"]
): Target => {
  const { baseUrl } = core.adapter.raw;

  if (ENCODED_SEPARATOR.test(path)) {
    throw new OutboundError(
      "Invalid",
      "A raw path may not contain a backslash or an encoded slash, backslash or dot",
      { provider: core.adapter.name }
    );
  }

  const base = new URL(baseUrl);
  const url = new URL(buildUrl(baseUrl, path, query));
  const root = base.pathname.replace(/\/+$/u, "");

  if (
    url.origin !== base.origin ||
    !(url.pathname === root || url.pathname.startsWith(`${root}/`))
  ) {
    throw refuse(
      core,
      `${path} leaves the ${core.adapter.name} API, so raw will not send it`
    );
  }

  const relative = `/${url.pathname
    .slice(root.length)
    .split("/")
    .filter((part) => part !== "")
    .join("/")}`;

  url.pathname = `${root}${relative}`;

  return { path: relative, query: url.searchParams, url: url.toString() };
};

/**
 * `nativeOffBy` names the plugin that turns the `native` capability off, when
 * one does. It is asked for apart from the gate, because the gate records a
 * plugin only for a capability the adapter declared, and raw exists on every
 * adapter.
 */
export const makeRawClient = (
  core: Core,
  nativeOffBy?: string | undefined
): RawClient => {
  const { adapter } = core;

  // async, so a refusal rejects like every other failure and a chained
  // `.catch()` sees it.
  const request = async (
    method: HttpMethod,
    path: string,
    options: RawRequestOptions = {}
  ): Promise<Json> => {
    if (adapter.members !== undefined) {
      throw refuse(
        core,
        `raw is not available on a combined instance: it belongs to one vendor. Use outbound.workspace("provider:workspace").raw, for example ${adapter.members.map((member) => `"${member.name}:${member.workspaceId}"`).join(" or ")}`
      );
    }

    if (nativeOffBy !== undefined) {
      throw refuse(
        core,
        `raw is not available: the ${nativeOffBy} plugin turned the vendor's own reads off (native), and raw returns the same untouched payload`
      );
    }

    const target = resolve(core, path, options.query);

    if (adapter.raw.isSecret?.(target.path, target.query) === true) {
      throw refuse(
        core,
        `${method} ${target.path} returns secrets (keys or passwords) on ${adapter.name}, so raw never reads it`
      );
    }

    const isRead = adapter.raw.isRead(method, target.path);

    if (!core.allowWrites && !isRead) {
      throw refuse(
        core,
        `${method} ${target.path} is not a known read on ${adapter.name}. The SDK is read-only; pass allowWrites: true to createOutbound to permit it`
      );
    }

    // A read is safe to repeat. A request that is not a known read may have
    // been applied before its response was lost, so it is sent once unless
    // the caller asks for retries.
    const settings =
      isRead || options.retries !== undefined
        ? options
        : { ...options, retries: 0 };

    return await perform(core, "raw", settings, async (state) => {
      const spec = adapter.raw.authorize({
        body: options.body,
        lane: options.lane,
        method,
        url: target.url,
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
