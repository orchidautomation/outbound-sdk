// Authenticating a webhook from a vendor that does not sign its payloads.
// The shared secret is looked for in the URL path, the query and two headers.

const encoder = new TextEncoder();

/** A comparison that takes the same time whether or not the strings match. */
export const timingSafeEqual = (left: string, right: string): boolean => {
  const a = encoder.encode(left);
  const b = encoder.encode(right);
  let difference = Math.abs(a.length - b.length);

  for (let index = 0; index < Math.max(a.length, b.length); index += 1) {
    // Adding the distance for every byte keeps the loop free of early exits.
    difference += Math.abs((a[index] ?? 0) - (b[index] ?? 0));
  }

  return difference === 0;
};

const QUERY_KEYS = ["secret", "token", "key"];
const HEADERS = ["x-webhook-secret", "x-outbound-secret"];

const isPresent = (value: string | null | undefined): value is string =>
  value !== undefined && value !== null && value !== "";

/** Every place a caller may have put the shared secret. */
const candidates = (url: string, headers: Headers): string[] => {
  const parsed = URL.canParse(url) ? new URL(url) : undefined;
  const bearer = headers.get("authorization")?.replace(/^Bearer\s+/iu, "");

  return [
    ...(parsed?.pathname
      .split("/")
      .map((segment) => decodeURIComponent(segment)) ?? []),
    ...QUERY_KEYS.map((key) => parsed?.searchParams.get(key)),
    ...HEADERS.map((name) => headers.get(name)),
    bearer,
  ].filter((value) => isPresent(value));
};

/** `true` when the request carries the shared secret. */
export const carriesSecret = (
  url: string,
  headers: Headers,
  secret: string
): boolean => {
  let found = false;

  // Every candidate is compared, so timing does not reveal which one matched.
  for (const candidate of candidates(url, headers)) {
    found = timingSafeEqual(candidate, secret) || found;
  }

  return found;
};
