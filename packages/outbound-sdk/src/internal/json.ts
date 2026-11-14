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
