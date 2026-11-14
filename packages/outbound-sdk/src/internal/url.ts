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
