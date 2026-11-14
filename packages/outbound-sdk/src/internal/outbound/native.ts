// outbound.native: the vendor's own reads, by name. The catalog comes from the
// adapter; the request goes through the same engine as every other read, so
// it is throttled, retried and kept free of secrets like the rest.

import { requireCapability } from "../capabilities.ts";
import type { OperationOptions } from "../engine/engine.ts";
import { OutboundError } from "../errors.ts";
import { isJsonObject } from "../json.ts";
import type { Json, JsonObject } from "../json.ts";
import type { NativeCatalog, NativeParam, NativeRead } from "../native.ts";
import { buildUrl } from "../url.ts";
import type { QueryValue } from "../url.ts";
import type {
  NativeClient,
  NativeParams,
  NativeReads,
  NativeResult,
} from "./api.ts";
import { metaFor, perform } from "./core.ts";
import type { Core } from "./core.ts";

const invalid = (core: Core, message: string): OutboundError =>
  new OutboundError("Invalid", message, { provider: core.adapter.name });

const TYPE_CHECKS: Readonly<
  Record<NativeParam["type"], (value: Json) => boolean>
> = {
  boolean: (value) => value === true || value === false,
  json: () => true,
  list: (value) =>
    Array.isArray(value) &&
    value.every((item) => !isJsonObject(item) && !Array.isArray(item)),
  number: (value) => Number.isFinite(value),
  string: (value) => String(value) === value,
};

interface Built {
  readonly path: string;
  readonly query: Record<string, QueryValue>;
  /** Query keys sent once per value, in order. */
  readonly repeated: readonly (readonly [string, string])[];
  readonly body: JsonObject | undefined;
}

const scalar = (value: Json): QueryValue =>
  isJsonObject(value) || Array.isArray(value) ? JSON.stringify(value) : value;

const place = (
  built: Built,
  name: string,
  param: NativeParam,
  value: Json
): Built => {
  if (param.in === "path") {
    return {
      ...built,
      path: built.path.replace(`{${name}}`, encodeURIComponent(String(value))),
    };
  }

  if (param.in === "query" && param.type === "list" && Array.isArray(value)) {
    return {
      ...built,
      repeated: [
        ...built.repeated,
        ...value.map((item) => [name, String(item)] as const),
      ],
    };
  }

  return param.in === "query"
    ? { ...built, query: { ...built.query, [name]: scalar(value) } }
    : { ...built, body: { ...built.body, [name]: value } };
};

type Bound = (
  params?: NativeParams,
  options?: OperationOptions
) => Promise<NativeResult>;

const withRepeated = (url: string, repeated: Built["repeated"]): string => {
  if (repeated.length === 0) {
    return url;
  }

  const parsed = new URL(url);

  for (const [name, value] of repeated) {
    parsed.searchParams.append(name, value);
  }

  return parsed.toString();
};

interface Named {
  readonly name: string;
  readonly read: NativeRead;
}

/** Checks the parameters against the catalog entry and places each one. */
const build = (
  core: Core,
  { name, read }: Named,
  params: NativeParams
): Built => {
  const declared = Object.entries(read.params ?? {});
  const known = new Set(declared.map(([param]) => param));
  const unknown = Object.keys(params).find((param) => !known.has(param));

  if (unknown !== undefined) {
    throw invalid(
      core,
      `${name} has no parameter "${unknown}". It takes: ${[...known].join(", ") || "nothing"}`
    );
  }

  let built: Built = {
    body: read.method === "POST" ? {} : undefined,
    path: read.path,
    query: {},
    repeated: [],
  };

  for (const [param, spec] of declared) {
    const value = params[param];

    if (value === undefined || value === null) {
      if (spec.required === true || spec.in === "path") {
        throw invalid(core, `${name} needs "${param}"`);
      }

      continue;
    }

    if (!TYPE_CHECKS[spec.type](value)) {
      throw invalid(core, `${name}: "${param}" must be a ${spec.type}`);
    }

    built = place(built, param, spec, value);
  }

  return built;
};

export const makeNativeClient = <Native extends NativeCatalog>(
  core: Core
): NativeClient<Native> => {
  const { adapter } = core;
  // SAFETY: an adapter's catalog is a NativeCatalog; the default type only hides its names.
  const catalog = (adapter.native ?? {}) as NativeCatalog;

  const read = (
    name: string,
    params: NativeParams = {},
    options: OperationOptions = {}
  ): Promise<NativeResult> => {
    if (adapter.members !== undefined) {
      throw new OutboundError(
        "Unsupported",
        "native is not available on a combined instance. Use outbound.workspace(id).native",
        { provider: adapter.name }
      );
    }

    requireCapability(core.gate, "native", "Reading the vendor's own data");
    const entry = Object.hasOwn(catalog, name) ? catalog[name] : undefined;

    if (entry === undefined) {
      throw invalid(
        core,
        `${adapter.name} has no native read "${name}". See outbound.native.catalog`
      );
    }

    const built = build(core, { name, read: entry }, params);

    return perform(core, `native.${name}`, options, async (state) => {
      const spec = adapter.raw.authorize({
        body: built.body,
        lane: entry.lane,
        method: entry.method,
        url: withRepeated(
          buildUrl(
            entry.baseUrl ?? adapter.raw.baseUrl,
            built.path,
            built.query
          ),
          built.repeated
        ),
      });

      const response = await core.engine
        .contextFor(adapter, state)
        .request(spec);

      return {
        data: response.body,
        meta: metaFor(core, state, { complete: true, evidence: "exact" }),
      };
    });
  };

  const reads: Partial<Record<keyof Native, Bound>> = {};

  for (const name of Object.keys(catalog)) {
    // SAFETY: the name was just read from the catalog, whose keys are keyof Native.
    reads[name as keyof Native] = (params, options) =>
      read(name, params, options);
  }

  return {
    // SAFETY: the catalog is the adapter's own, typed by the caller as Native.
    catalog: catalog as Native,
    provider: adapter.name,
    read,
    // SAFETY: one function per catalog name, each taking that read's parameters.
    reads: reads as NativeReads<Native>,
  };
};
