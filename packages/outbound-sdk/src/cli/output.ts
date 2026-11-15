// How the CLI prints an answer. Records lose `raw`, the vendor's own payload,
// unless `--raw` asks for it: for a reply it can carry the whole quoted
// thread as text and HTML, even when `--bodies` was not passed.

import { isJsonObject } from "../internal/json.ts";
import type { Json } from "../internal/json.ts";

/** The CLI's own `--compact` and `--raw`. */
export interface PrintOptions {
  readonly compact?: boolean | undefined;
  readonly raw?: boolean | undefined;
}

// A record carries `ref` and `schemaVersion`. A vendor payload, such as what
// `native` prints, does not, so it is printed whole.
const isRecord = (value: Json): boolean =>
  isJsonObject(value) && "ref" in value && "schemaVersion" in value;

/** The answer with `raw` taken off every record in it, at any depth. */
export const withoutRaw = (value: Json): Json => {
  if (Array.isArray(value)) {
    return value.map(withoutRaw);
  }

  if (!isJsonObject(value)) {
    return value;
  }

  return Object.fromEntries(
    Object.entries(value)
      .filter(([key]) => !(key === "raw" && isRecord(value)))
      .map(([key, item]) => [key, withoutRaw(item)])
  );
};

export const printAnswer = (
  write: (text: string) => void,
  value: Json,
  options: PrintOptions
): void => {
  const shown = options.raw === true ? value : withoutRaw(value);

  write(
    options.compact === true
      ? JSON.stringify(shown)
      : JSON.stringify(shown, null, 2)
  );
};
