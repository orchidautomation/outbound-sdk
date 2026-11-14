// Every vendor pages differently (cursor, offset, page number). Callers see
// one opaque string, which also records what it belongs to so a cursor from
// one listing cannot be replayed against another.

import { OutboundError } from "./errors.ts";
import { field, isString, parseJson } from "./json.ts";
import type { Json } from "./json.ts";

const VERSION = 1;

const toBase64Url = (value: string): string => {
  const bytes = new TextEncoder().encode(value);
  let binary = "";

  for (const byte of bytes) {
    binary += String.fromCodePoint(byte);
  }

  return btoa(binary)
    .replaceAll("+", "-")
    .replaceAll("/", "_")
    .replace(/[=]+$/u, "");
};

const fromBase64Url = (value: string): string | undefined => {
  try {
    const binary = atob(value.replaceAll("-", "+").replaceAll("_", "/"));
    const bytes = Uint8Array.from(binary, (char) => char.codePointAt(0) ?? 0);

    return new TextDecoder().decode(bytes);
  } catch {
    return undefined;
  }
};

export interface CursorScope {
  readonly provider: string;
  readonly workspaceId: string;
  /** The listing the cursor belongs to, for example `campaigns.list`. */
  readonly action: string;
}

export const encodeCursor = (scope: CursorScope, next: Json): string =>
  toBase64Url(
    JSON.stringify({
      a: scope.action,
      n: next,
      p: scope.provider,
      v: VERSION,
      w: scope.workspaceId,
    })
  );

/** Returns the adapter's `next` value, or throws `Invalid` for a foreign cursor. */
export const decodeCursor = (scope: CursorScope, cursor: string): Json => {
  const decoded = fromBase64Url(cursor);
  const parsed = decoded === undefined ? undefined : parseJson(decoded);
  const next = field(parsed, "n");

  const matches =
    field(parsed, "v") === VERSION &&
    field(parsed, "p") === scope.provider &&
    field(parsed, "w") === scope.workspaceId &&
    field(parsed, "a") === scope.action;

  if (!matches || next === undefined) {
    const owner = isString(field(parsed, "a"))
      ? ` (it belongs to ${String(field(parsed, "a"))})`
      : "";

    throw new OutboundError(
      "Invalid",
      `The cursor is not valid for ${scope.action}${owner}`,
      {
        provider: scope.provider,
      }
    );
  }

  return next;
};
