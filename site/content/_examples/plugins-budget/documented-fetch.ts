// A `fetch` that answers Instantly's "list accounts" request with the two
// pages in fixtures/instantly/. Those files are built from Instantly's
// published schema and example values. They are not captured responses.
import { readFile } from "node:fs/promises";

const FIXTURES = new URL("../../../../fixtures/instantly/", import.meta.url);

const page = (name: string): Promise<string> =>
  readFile(new URL(name, FIXTURES), "utf-8");

/** Every request this fetch has answered, as `METHOD path`. */
export const seen: string[] = [];

export const documentedFetch: typeof fetch = async (input) => {
  const url = new URL(input instanceof Request ? input.url : String(input));

  seen.push(`GET ${url.pathname}`);

  const body = await page(
    url.searchParams.has("starting_after")
      ? "listAccounts.page2.json"
      : "listAccounts.json"
  );

  return new Response(body, {
    headers: { "content-type": "application/json" },
  });
};
