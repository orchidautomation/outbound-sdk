// Vendor payloads are JSON. Everything read from the network is typed as Json
// and narrowed with these guards, so no adapter handles an untyped value.

export type Json = string | number | boolean | null | Json[] | JsonObject;

export interface JsonObject {
  [key: string]: Json;
}

export const isJsonObject = (value: Json | undefined): value is JsonObject =>
  typeof value === "object" && value !== null && !Array.isArray(value);

export const isJsonArray = (value: Json | undefined): value is Json[] =>
  Array.isArray(value);

export const isString = (value: Json | undefined): value is string =>
  typeof value === "string";

export const isNumber = (value: Json | undefined): value is number =>
  typeof value === "number" && Number.isFinite(value);

export const isBoolean = (value: Json | undefined): value is boolean =>
  typeof value === "boolean";

/** Reads `key` when `value` is an object, otherwise `undefined`. */
export const field = (value: Json | undefined, key: string): Json | undefined =>
  isJsonObject(value) ? value[key] : undefined;

/** A non-empty trimmed string, or `null`. Numbers become strings. */
export const text = (value: Json | undefined): string | null => {
  if (isNumber(value)) {
    return String(value);
  }

  if (!isString(value)) {
    return null;
  }

  const trimmed = value.trim();

  return trimmed === "" ? null : trimmed;
};

/** A finite number, or `null`. Numeric strings are parsed. */
export const count = (value: Json | undefined): number | null => {
  if (isNumber(value)) {
    return value;
  }

  if (isString(value) && value.trim() !== "") {
    const parsed = Number(value);

    return Number.isFinite(parsed) ? parsed : null;
  }

  return null;
};

/** A first and a last name as one, or `null` when the vendor gave neither. */
export const fullName = (
  first: Json | undefined,
  last: Json | undefined
): string | null => {
  const name = [text(first), text(last)]
    .filter((part) => part !== null)
    .join(" ");

  return name === "" ? null : name;
};

export const flag = (value: Json | undefined): boolean | null =>
  isBoolean(value) ? value : null;

export const list = (value: Json | undefined): Json[] =>
  isJsonArray(value) ? value : [];

export const objects = (value: Json | undefined): JsonObject[] =>
  list(value).filter((item) => isJsonObject(item));

/** An ISO 8601 UTC timestamp, or `null` when the value is not a date. */
export const timestamp = (value: Json | undefined): string | null => {
  if (!isString(value) && !isNumber(value)) {
    return null;
  }

  // Epoch seconds are below 1e11; anything larger is already milliseconds.
  const epoch =
    isNumber(value) && value < 100_000_000_000 ? value * 1000 : value;

  const date = new Date(epoch);

  return Number.isNaN(date.getTime()) ? null : date.toISOString();
};

/** A lowercased, trimmed email address, or `null`. */
export const emailAddress = (value: Json | undefined): string | null => {
  const raw = text(value);

  return raw !== null && raw.includes("@") ? raw.toLowerCase() : null;
};

/** Parses a JSON string, returning `undefined` when it is not valid JSON. */
export const parseJson = (source: string): Json | undefined => {
  try {
    // SAFETY: JSON.parse only ever produces JSON values.
    return JSON.parse(source) as Json;
  } catch {
    return undefined;
  }
};

const isScalar = (value: Json): value is string | number | boolean =>
  isString(value) || isNumber(value) || isBoolean(value);

/** An object's scalar values as strings, for a lead's custom fields. */
export const stringMap = (value: Json | undefined) =>
  Object.fromEntries(
    Object.entries(isJsonObject(value) ? value : {}).flatMap(([key, entry]) =>
      isScalar(entry) ? [[key, String(entry)] as const] : []
    )
  );

/** A JSON object without the keys whose value is `null` or `undefined`. */
export const compactObject = (
  entries: Readonly<Record<string, Json | undefined>>
): JsonObject => {
  const result: JsonObject = {};

  for (const [key, value] of Object.entries(entries)) {
    if (value !== null && value !== undefined) {
      result[key] = value;
    }
  }

  return result;
};

/**
 * A typed value as plain JSON, the way `JSON.stringify` would write it:
 * `undefined` keys are dropped and anything that is not JSON becomes `null`.
 */
export const toJson = <Value>(value: Value): Json =>
  parseJson(JSON.stringify(value) ?? "null") ?? null;

/**
 * `toJson`, or `undefined` for a value `JSON.stringify` cannot write (a
 * BigInt, a cycle). For an input from a caller, such as a tool's.
 */
export const jsonInput = <Value>(value: Value): Json | undefined => {
  try {
    return toJson(value);
  } catch {
    return undefined;
  }
};

/**
 * Says which of the `given` keys is not one of `known`, or `undefined` when
 * every one is. Used so an input that would be ignored is refused instead.
 */
export const strayKey = (
  known: readonly string[],
  given: readonly string[],
  noun = "an input"
): string | undefined => {
  const stray = given.find((key) => !known.includes(key));

  return stray === undefined
    ? undefined
    : `"${stray}" is not ${noun}. It takes: ${known.toSorted().join(", ") || "nothing"}`;
};

/** `strayKey` for a JSON input: which key of `input` is not one of `known`. */
export const unknownKey = (
  known: readonly string[],
  input: Json | undefined
): string | undefined =>
  strayKey(known, isJsonObject(input) ? Object.keys(input) : []);

/**
 * A copy of `value` without any key that matches `secret`, at any depth. A
 * vendor payload kept on a record's `raw` can carry a mailbox password, a
 * webhook's signing secret or the headers it sends, and none of them belongs
 * in a record a caller logs or stores.
 */
export const withoutKeys = (value: Json, secret: RegExp): Json => {
  if (isJsonArray(value)) {
    return value.map((entry) => withoutKeys(entry, secret));
  }

  if (!isJsonObject(value)) {
    return value;
  }

  return Object.fromEntries(
    Object.entries(value).flatMap(([key, entry]) =>
      secret.test(key) ? [] : [[key, withoutKeys(entry, secret)] as const]
    )
  );
};
