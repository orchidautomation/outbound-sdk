// API keys and email addresses never appear in errors, hooks or logs.
// Everything that builds a message for those surfaces goes through here.

const EMAIL = /[\w.!#$%&'*+/=?^`{|}~-]+@[\w-]+(?:\.[\w-]+)+/gu;

export const REDACTED_KEY = "[redacted-key]";
export const REDACTED_EMAIL = "[redacted-email]";

/** Replaces every secret and every email address in `value`. */
export const redactText = (
  value: string,
  secrets: readonly string[] = []
): string => {
  let result = value;

  for (const secret of secrets) {
    if (secret.length >= 4) {
      result = result.replaceAll(secret, REDACTED_KEY);
      result = result.replaceAll(encodeURIComponent(secret), REDACTED_KEY);
    }
  }

  return result.replaceAll(EMAIL, REDACTED_EMAIL);
};

/** A URL safe to log: secrets and emails removed, including from the query. */
export const redactUrl = (
  url: string,
  secrets: readonly string[] = []
): string => redactText(url, secrets);

/** A plain copy of a cause with every secret and email address removed. */
export type RedactedJson =
  | boolean
  | number
  | string
  | null
  | readonly RedactedJson[]
  | { readonly [key: string]: RedactedJson };

// Deep enough for any vendor error body; a cycle or a huge tree stops here.
const MAX_DEPTH = 8;
const TRUNCATED = "[truncated]";

const isPlain = (cause: unknown): cause is boolean | number =>
  typeof cause === "number" || typeof cause === "boolean";

const isText = (cause: unknown): cause is string => typeof cause === "string";

const isObject = (cause: unknown): cause is object =>
  typeof cause === "object" && cause !== null;

const redactJson = (
  cause: unknown,
  secrets: readonly string[],
  depth: number
): RedactedJson => {
  if (cause === null || cause === undefined) {
    return null;
  }

  if (isPlain(cause)) {
    return cause;
  }

  if (isText(cause)) {
    return redactText(cause, secrets);
  }

  if (cause instanceof Error) {
    return redactText(`${cause.name}: ${cause.message}`, secrets);
  }

  if (!isObject(cause)) {
    // A bigint, a symbol or a function: keep what it says, never the thing.
    return redactText(String(cause), secrets);
  }

  if (depth >= MAX_DEPTH) {
    return TRUNCATED;
  }

  if (Array.isArray(cause)) {
    return cause.map((item) => redactJson(item, secrets, depth + 1));
  }

  return Object.fromEntries(
    Object.entries(cause).flatMap(([key, value]) =>
      value === undefined
        ? []
        : [[redactText(key, secrets), redactJson(value, secrets, depth + 1)]]
    )
  );
};

const redactError = (
  cause: Error,
  secrets: readonly string[],
  depth: number
): Error => {
  const copy = new Error(redactText(cause.message, secrets), {
    cause:
      cause.cause === undefined || depth >= MAX_DEPTH
        ? undefined
        : redactCauseAt(cause.cause, secrets, depth + 1),
  });

  copy.name = cause.name;

  if (cause.stack !== undefined) {
    copy.stack = redactText(cause.stack, secrets);
  }

  return copy;
};

const redactCauseAt = (
  cause: unknown,
  secrets: readonly string[],
  depth: number
): Error | RedactedJson | undefined => {
  if (cause === undefined) {
    return undefined;
  }

  if (cause instanceof Error) {
    // An OutboundError was redacted when it was built; it keeps its class.
    return cause.name === "OutboundError"
      ? cause
      : redactError(cause, secrets, depth);
  }

  return redactJson(cause, secrets, depth);
};

/**
 * What an error keeps as its `cause`: a copy with every secret and email
 * address removed. Loggers print the cause chain, and a vendor's error body
 * or a network error can hold an address or echo the key. A vendor response
 * becomes plain data; another Error becomes a new Error with the same name,
 * message and stack, redacted.
 */
export const redactCause = (
  cause: unknown,
  secrets: readonly string[] = []
): Error | RedactedJson | undefined => redactCauseAt(cause, secrets, 0);
