/** A list is sent as the key repeated, once per item. */
export type QueryValue =
  | string
  | number
  | boolean
  | readonly string[]
  | null
  | undefined;

/** Joins a base URL and a path and appends the defined query values. */
export const buildUrl = (
  baseUrl: string,
  path: string,
  query: Readonly<Record<string, QueryValue>> = {}
): string => {
  const url = new URL(
    `${baseUrl.replace(/\/+$/u, "")}/${path.replace(/^\/+/u, "")}`
  );

  for (const [key, value] of Object.entries(query)) {
    if (Array.isArray(value)) {
      for (const item of value) {
        url.searchParams.append(key, item);
      }
    } else if (value !== undefined && value !== null) {
      url.searchParams.set(key, String(value));
    }
  }

  return url.toString();
};

const LINKEDIN_PROFILE = /linkedin\.com\/(?:in|pub)\/(?<slug>[^/?#\s]+)/iu;

/**
 * The part of a LinkedIn profile URL that names the person, lowercased, or
 * `null` when the text is not a profile URL. Two URLs for the same person can
 * differ in scheme, host prefix, trailing slash and query; the slug does not.
 * A slug that is not valid percent-encoding is kept undecoded.
 */
export const profileSlug = (url: string | null | undefined): string | null => {
  const slug =
    url === null || url === undefined
      ? undefined
      : LINKEDIN_PROFILE.exec(url)?.groups?.slug;

  if (slug === undefined) {
    return null;
  }

  try {
    return decodeURIComponent(slug).toLowerCase();
  } catch {
    // A stray `%` is not an escape; the slug is kept as it was written.
    return slug.toLowerCase();
  }
};
