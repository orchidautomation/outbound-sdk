export type QueryValue = string | number | boolean | null | undefined;

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
    if (value !== undefined && value !== null) {
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
 */
export const profileSlug = (url: string | null | undefined): string | null => {
  const slug =
    url === null || url === undefined
      ? undefined
      : LINKEDIN_PROFILE.exec(url)?.groups?.slug;

  return slug === undefined ? null : decodeURIComponent(slug).toLowerCase();
};
