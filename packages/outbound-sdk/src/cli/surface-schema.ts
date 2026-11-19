// The input schema of a merged tool: what each tool it is made of takes, in
// one object, and the `view` or `checks` that picks between them.

import { isJsonObject, isString, toJson } from "../internal/json.ts";
import type { Json, JsonObject } from "../internal/json.ts";
import type { OutboundTool } from "../tools/index.ts";
import type { Group } from "./surface-groups.ts";

export const propertiesOf = (tool: OutboundTool): JsonObject => {
  const properties = isJsonObject(tool.parameters)
    ? tool.parameters["properties"]
    : undefined;

  return isJsonObject(properties) ? properties : {};
};

export const requiredOf = (tool: OutboundTool): readonly string[] => {
  const required = isJsonObject(tool.parameters)
    ? tool.parameters["required"]
    : undefined;

  return Array.isArray(required) ? required.filter(isString) : [];
};

// A property's type, without what only documents or bounds it.
const typeOnly = (schema: Json): Json => {
  if (!isJsonObject(schema)) {
    return schema;
  }

  const { default: _default, description: _description, ...rest } = schema;

  return rest;
};

// What kind of value a property takes: its type, values and items, not its bounds.
const kindOf = (schema: Json): Json => {
  if (!isJsonObject(schema)) {
    return schema;
  }

  const { anyOf, enum: values, items, type } = schema;

  return toJson({
    anyOf: Array.isArray(anyOf) ? anyOf.map(kindOf) : undefined,
    enum: values,
    items: items === undefined ? undefined : kindOf(items),
    type,
  });
};

const describedAs = (schema: Json): string | undefined => {
  const description = isJsonObject(schema) ? schema["description"] : undefined;

  return isString(description) ? description : undefined;
};

/** The members' inputs in one object; a field members define apart takes either. */
export const mergedProperties = (
  group: Group,
  present: ReadonlyMap<string, OutboundTool>
): JsonObject => {
  const merged: Record<string, Json> = {};
  const owners = new Map<string, string[]>();

  for (const [key, tool] of present) {
    for (const [name, schema] of Object.entries(propertiesOf(tool))) {
      owners.set(name, [...(owners.get(name) ?? []), key]);
      const known = merged[name];

      if (known === undefined) {
        merged[name] = schema;
      } else if (
        JSON.stringify(kindOf(known)) !== JSON.stringify(kindOf(schema))
      ) {
        const first =
          isJsonObject(known) &&
          Array.isArray(known["anyOf"]) &&
          describedAs(known) !== undefined &&
          !("type" in known)
            ? known["anyOf"]
            : [typeOnly(known)];

        merged[name] = {
          anyOf: [...first, typeOnly(schema)],
          description: describedAs(known) ?? "",
        };
      }
    }
  }

  for (const [name, keys] of owners) {
    const schema = merged[name];

    if (keys.length < present.size && isJsonObject(schema)) {
      merged[name] = {
        ...schema,
        description:
          `${describedAs(schema) ?? ""} (${group.by} ${keys.join(", ")})`.trim(),
      };
    }
  }

  return merged;
};

export const selectorSchema = (
  group: Group,
  keys: readonly string[],
  defaults: readonly string[]
): Json => {
  const value = { enum: [...keys], type: "string" };

  return group.by === "view"
    ? { ...value, default: defaults[0] ?? null }
    : {
        default: [...defaults],
        description: "The checks to run, each answered under data.<check>.",
        items: value,
        type: "array",
      };
};
