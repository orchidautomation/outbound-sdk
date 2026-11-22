// A `fetch` that answers from the fixture files in the repository's
// fixtures/<vendor>/ folder, so a sample runs the real adapter with no
// network. The fixtures follow each vendor's documented field names; every
// value in them is made up. They are not responses captured from a live
// account.
import { readFileSync } from "node:fs";

export interface Route {
  readonly method: string;
  /** Matched against the whole path. */
  readonly path: RegExp;
  /** Picks the fixture file from the request URL and body. */
  readonly fixture: (url: URL, body: string) => string;
}

export interface FixtureFetch {
  readonly fetch: typeof fetch;
  /** Every request the SDK made, as `METHOD path?query body`. */
  readonly requests: string[];
}

/** A route that always answers with one file. */
export const file =
  (name: string): ((url: URL, body: string) => string) =>
  () =>
    name;

export const fixtureFetch = (
  vendor: string,
  routes: readonly Route[]
): FixtureFetch => {
  const folder = new URL(`../../../../fixtures/${vendor}/`, import.meta.url);
  const requests: string[] = [];

  const answer: typeof fetch = (input, init) => {
    const url = new URL(input instanceof Request ? input.url : input);
    const method = init?.method ?? "GET";
    const body = String(init?.body ?? "");

    const route = routes.find(
      (candidate) =>
        candidate.method === method && candidate.path.test(url.pathname)
    );

    // Keys never appear in a printed request.
    const shown = new URL(url);

    shown.searchParams.delete("api_key");
    requests.push(
      `${method} ${shown.pathname}${shown.search} ${body}`.trimEnd()
    );

    if (route === undefined) {
      return Promise.resolve(
        Response.json({ message: "no fixture" }, { status: 404 })
      );
    }

    const name = route.fixture(url, body);

    return Promise.resolve(
      new Response(readFileSync(new URL(name, folder), "utf-8"), {
        headers: { "content-type": "application/json" },
      })
    );
  };

  return { fetch: answer, requests };
};
