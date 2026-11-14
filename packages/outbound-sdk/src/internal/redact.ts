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
