// A vendor's own reads that have no normalized form. Each adapter lists them
// in a catalog, so nothing the vendor can report is lost: a read is either
// normalized, or named here and returned as the vendor sent it. No vendor
// publishes a client of its own, so this catalog is the typed native client.

import type { Json } from "./json.ts";

export interface NativeParam {
  /** Where the value goes in the request. */
  readonly in: "body" | "path" | "query";
  readonly type: "boolean" | "json" | "number" | "string";
  /** Path parameters are always required. */
  readonly required?: boolean | undefined;
  readonly description: string;
}

export interface NativeRead {
  /** What the read answers, in one sentence. */
  readonly description: string;
  readonly method: "GET" | "POST";
  /** The vendor's path, with `{name}` for each path parameter. */
  readonly path: string;
  readonly params?: Readonly<Record<string, NativeParam>> | undefined;
  /** A rate lane declared in the adapter's limits. */
  readonly lane?: string | undefined;
  /** A different host, for a vendor's sister service. Defaults to the adapter's base URL. */
  readonly baseUrl?: string | undefined;
  /** The vendor's documentation page for the read. */
  readonly docs?: string | undefined;
}

/** The reads by name. Names are camelCase, for example `inboxUnread`. */
export type NativeCatalog = Readonly<Record<string, NativeRead>>;

/** An adapter with no native reads. */
export type NoNative = Record<never, never>;

/** Keeps each read's name and parameters as literal types. */
export const defineNative = <const Catalog extends NativeCatalog>(
  catalog: Catalog
): Catalog => catalog;

interface ValueTypes {
  readonly boolean: boolean;
  readonly json: Json;
  readonly number: number;
  readonly string: string;
}

type Declared<Read> = Read extends {
  readonly params: infer Params extends Readonly<Record<string, NativeParam>>;
}
  ? Params
  : NoNative;

type RequiredNames<Params> = {
  [Name in keyof Params]: Params[Name] extends
    | { readonly required: true }
    | { readonly in: "path" }
    ? Name
    : never;
}[keyof Params];

type ValueOf<Param> = Param extends { readonly type: infer Type }
  ? Type extends keyof ValueTypes
    ? ValueTypes[Type]
    : Json
  : Json;

type TypedParams<Params> = {
  readonly [Name in RequiredNames<Params>]: ValueOf<Params[Name]>;
} & {
  readonly [Name in Exclude<keyof Params, RequiredNames<Params>>]?:
    | ValueOf<Params[Name]>
    | undefined;
};

/** The parameters one catalogued read takes, as a typed object. */
export type NativeParamsOf<Read> = TypedParams<Declared<Read>>;

/** `true` when the read cannot be called without parameters. */
export type NeedsParams<Read> = [RequiredNames<Declared<Read>>] extends [never]
  ? false
  : true;
