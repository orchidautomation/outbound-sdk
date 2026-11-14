// Builders for the entries of the native catalog. Each keeps the parameter's
// place and type as literal types, so a read's parameters stay typed.

import type { NativeParam } from "../internal/native.ts";

type Kind = NativeParam["type"];

export interface Placed<Place extends NativeParam["in"], Type extends Kind> {
  readonly description: string;
  readonly in: Place;
  readonly type: Type;
}

export interface Needed<
  Place extends NativeParam["in"],
  Type extends Kind,
> extends Placed<Place, Type> {
  readonly required: true;
}

export const inQuery = <Type extends Kind>(
  type: Type,
  description: string
): Placed<"query", Type> => ({ description, in: "query", type });

export const inQueryRequired = <Type extends Kind>(
  type: Type,
  description: string
): Needed<"query", Type> => ({
  description,
  in: "query",
  required: true,
  type,
});

export const inBody = <Type extends Kind>(
  type: Type,
  description: string
): Placed<"body", Type> => ({ description, in: "body", type });

export const inBodyRequired = <Type extends Kind>(
  type: Type,
  description: string
): Needed<"body", Type> => ({ description, in: "body", required: true, type });

/** Every path parameter Instantly documents is a string. */
export const inPath = (description: string): Placed<"path", "string"> => ({
  description,
  in: "path",
  type: "string",
});

/** The cursor paging every Instantly list shares. */
export const PAGE = {
  limit: inQuery("number", "Page size, 1 to 100."),
  starting_after: inQuery(
    "string",
    "The next_starting_after of the previous page."
  ),
};

/** The reference page of one endpoint, from its path under `api-reference/`. */
export const docs = (page: string): string =>
  `https://developer.instantly.ai/api-reference/${page}`;
