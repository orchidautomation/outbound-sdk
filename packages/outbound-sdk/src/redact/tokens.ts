// The tokens redact writes for addresses and profiles: the key they are made
// with, from the caller or OUTBOUND_REDACT_KEY, and the values behind them,
// held in memory only.

import { readEnv } from "../internal/env.ts";
import { OutboundError } from "../internal/errors.ts";
import { hmacSha256Hex } from "../internal/sha256.ts";

/** The shortest `key` `redact` accepts. */
export const MIN_KEY_LENGTH = 32;

/** The environment variable `redact` reads its key from when none is given. */
export const REDACT_KEY_ENV = "OUTBOUND_REDACT_KEY";

// A key for this plugin alone, so a token names one person to the records it
// came with and to nothing outside them; or the caller's, so it names them
// to every record read under that key.
export const keyedToken = (
  secret: string | undefined
): ((value: string) => string) => {
  const key =
    secret === undefined
      ? crypto.getRandomValues(new Uint8Array(32))
      : new TextEncoder().encode(secret);

  return (value) => `redacted:${hmacSha256Hex(key, value).slice(0, 16)}`;
};

// The key is never put in a message: only its length is checked, and the
// message names where it came from.
export const checkedKey = (key: string | undefined): string | undefined => {
  const given = key ?? readEnv(REDACT_KEY_ENV);

  if (given === undefined || given.length >= MIN_KEY_LENGTH) {
    return given;
  }

  const source = key === undefined ? ` in ${REDACT_KEY_ENV}` : "";

  throw new OutboundError(
    "Invalid",
    `The redact key${source} must be at least ${MIN_KEY_LENGTH} characters. It is a secret: make one with \`openssl rand -hex 32\``
  );
};

/** On every answer that holds a token from a redact with no key, by strategy. */
export const KEYLESS_NOTES = {
  hash: `redact's hash strategy has no key, so anyone can compute a token from a guessed email address or profile. Unkeyed hash is deprecated: set ${REDACT_KEY_ENV} or pass redact({ key }) to key it.`,
  mask: `redact has no key, so its tokens for addresses and profiles hold only within this instance or process and do not join across runs. Set ${REDACT_KEY_ENV} or pass redact({ key }) to keep them.`,
} as const;

let warnedUnkeyedHash = false;

/** Warns once per process that a hash with no key can be recomputed. */
export const warnUnkeyedHash = (): void => {
  if (!warnedUnkeyedHash) {
    warnedUnkeyedHash = true;
    // oxlint-disable-next-line no-console -- a deprecation must reach the developer, and the SDK has no logger.
    console.warn(`outbound-sdk: ${KEYLESS_NOTES.hash}`);
  }
};

export type Identifier = "email" | "linkedin";

/** The most tokens one redact remembers the value of; the oldest go first. */
export const KNOWN_TOKENS = 10_000;

export const TOKEN = /redacted:[0-9a-f]{16}/gu;

/**
 * The values behind the tokens this redact wrote for addresses and profiles,
 * held in memory for its lifetime and never written out.
 */
export interface Known {
  readonly remember: (token: string, kind: Identifier, value: string) => string;
  readonly kindOf: (token: string) => Identifier | null;
  /** Puts each known token's value back, for a call on its way to the vendor. */
  readonly unmask: (text: string) => string;
  /** Puts the tokens back where a value from `unmask` appears. */
  readonly remask: (text: string) => string;
}

export const knownTokens = (): Known => {
  const values = new Map<string, { kind: Identifier; value: string }>();

  return {
    kindOf: (token) => values.get(token)?.kind ?? null,
    remask: (text) => {
      let result = text;

      for (const [token, { value }] of values) {
        result = result.replaceAll(value, token);
      }

      return result;
    },
    remember: (token, kind, value) => {
      values.delete(token);
      values.set(token, { kind, value });

      if (values.size > KNOWN_TOKENS) {
        const [oldest] = values.keys();

        if (oldest !== undefined) {
          values.delete(oldest);
        }
      }

      return token;
    },
    unmask: (text) =>
      text.replaceAll(TOKEN, (token) => values.get(token)?.value ?? token),
  };
};
