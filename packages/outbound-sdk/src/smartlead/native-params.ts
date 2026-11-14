// Small builders for the native catalog's parameters, so each one is a line.
// They keep the place and the type as literal types, which is what gives a
// native read its typed parameters.

import type { NativeParam } from "../internal/native.ts";

type ParamType = NativeParam["type"];

/** A parameter and where it goes. Exported so the catalog's type can be named. */
export interface Placed<
  Where extends NativeParam["in"],
  Type extends ParamType,
> {
  readonly description: string;
  readonly in: Where;
  readonly type: Type;
}

export interface Needed<
  Where extends NativeParam["in"],
  Type extends ParamType,
> extends Placed<Where, Type> {
  readonly required: true;
}

/** Smartlead's reference pages. */
export const DOCS = "https://api.smartlead.ai/api-reference";

/** The sister services, each on its own host with the same `api_key`. */
export const DELIVERY_URL = "https://smartdelivery.smartlead.ai/api/v1";
export const PROSPECT_URL = "https://prospect-api.smartlead.ai/api/v1";
export const SENDERS_URL = "https://smart-senders.smartlead.ai/api/v1";
export const SERVERS_URL = "https://smartservers.smartlead.ai/api/v1";

export const query = <const Type extends ParamType>(
  type: Type,
  description: string
): Placed<"query", Type> => ({ description, in: "query", type });

export const queryRequired = <const Type extends ParamType>(
  type: Type,
  description: string
): Needed<"query", Type> => ({
  description,
  in: "query",
  required: true,
  type,
});

export const body = <const Type extends ParamType>(
  type: Type,
  description: string
): Placed<"body", Type> => ({ description, in: "body", type });

export const bodyRequired = <const Type extends ParamType>(
  type: Type,
  description: string
): Needed<"body", Type> => ({ description, in: "body", required: true, type });

/**
 * A path parameter. Smartlead's ids are numbers, but the SDK's ids are
 * strings, so an id from a normalized record can be passed as it is.
 */
export const path = (description: string): Placed<"path", "string"> => ({
  description,
  in: "path",
  type: "string",
});

/** `limit` and `offset` in the query, for the offset-paged lists. */
export const paged = (limit: string) => ({
  limit: query("number", limit),
  offset: query("number", "Rows to skip."),
});
