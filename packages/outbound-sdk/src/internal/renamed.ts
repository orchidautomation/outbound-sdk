// Input fields kept under an old name for one minor release. The old name is
// an optional field marked deprecated in the schema, so a tool's parameters
// and the generated input types still show it, and its value moves to the new
// name before the input is parsed. The `{ to }` link lives in a registry of
// its own, so nothing but `deprecated` and the description reaches JSON
// Schema.

import { z } from "zod";
import type { ZodType } from "zod";

import { isJsonObject } from "./json.ts";
import type { Json } from "./json.ts";

const REMOVED_IN = "0.4.0";

const renames = z.registry<{ readonly to: string }>();

/** The fields of an object schema, by name. */
type Fields = Readonly<Record<string, ZodType>>;

/**
 * The old name of the field `to`. Pass the new field's schema without its
 * default, so leaving the old name out does not set it.
 */
export const renamed = <Schema extends ZodType>(to: string, base: Schema) => {
  const field = base.optional().meta({
    deprecated: true,
    description: `Deprecated: renamed to \`${to}\`. Removed in ${REMOVED_IN}.`,
  });

  renames.add(field, { to });

  return field;
};

/** Each old name among the fields, with the name it moved to. */
const renamesIn = (fields: Fields) =>
  Object.entries(fields).flatMap(([from, schema]) => {
    const link = renames.get(schema);

    return link === undefined ? [] : [{ from, to: link.to }];
  });

/** The field names without the deprecated old names. */
export const liveKeys = (fields: Fields): string[] => {
  const old = new Set(renamesIn(fields).map((each) => each.from));

  return Object.keys(fields).filter((key) => !old.has(key));
};

export type Renamed =
  | { readonly input: Json | undefined; readonly notes: readonly string[] }
  | { readonly conflict: { readonly from: string; readonly to: string } };

/**
 * The input with each old name's value moved to its new name, and a note
 * for each old name used. Both names at once is a conflict, since either
 * value could be the one meant.
 */
export const applyRenames = (
  fields: Fields,
  input: Json | undefined
): Renamed => {
  if (!isJsonObject(input)) {
    return { input, notes: [] };
  }

  const moved = new Map(Object.entries(input));
  const notes: string[] = [];

  for (const { from, to } of renamesIn(fields)) {
    const value = moved.get(from);
    // A key set to `undefined` is left out, as it is for any other input.
    moved.delete(from);

    if (value !== undefined) {
      if (moved.get(to) !== undefined) {
        return { conflict: { from, to } };
      }

      moved.set(to, value);
      notes.push(
        `\`${from}\` is deprecated and will be removed in ${REMOVED_IN}; use \`${to}\`.`
      );
    }
  }

  return { input: Object.fromEntries(moved), notes };
};
