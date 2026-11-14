// Person keys come from exact identifiers only: a lowercased email address
// or a cleaned LinkedIn profile URL. There is no fuzzy matching on names or
// companies, so two records are linked only when a vendor gave both the same
// address or the same profile.

import { profileSlug } from "../internal/url.ts";

export const emailKey = (email: string | null): string | null => {
  const cleaned = email?.trim().toLowerCase() ?? "";

  return cleaned.includes("@") ? `email:${cleaned}` : null;
};

export const linkedinKey = (url: string | null): string | null => {
  const slug = profileSlug(url);

  return slug === null ? null : `linkedin:${slug}`;
};

/** Every exact identifier a record carries. The first is its primary key. */
export const keysOf = (record: {
  readonly email: string | null;
  readonly linkedinUrl: string | null;
}): string[] =>
  [emailKey(record.email), linkedinKey(record.linkedinUrl)].filter(
    (key) => key !== null
  );

/** Accepts a person key, an email address or a LinkedIn URL. */
export const toKey = (identifier: string): string | null => {
  const value = identifier.trim();
  const lower = value.toLowerCase();

  if (lower.startsWith("email:") || lower.startsWith("linkedin:")) {
    return lower;
  }

  return linkedinKey(value) ?? emailKey(value);
};
