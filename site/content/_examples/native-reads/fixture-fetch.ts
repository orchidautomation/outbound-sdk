// A `fetch` that answers from the fixture files in the repository's
// fixtures/heyreach/ folder, so the samples run with no network. The fixtures
// follow HeyReach's documented field names; every value in them is made up.
// They are not responses captured from a live account.
import { readFileSync } from "node:fs";

const FIXTURES = new URL("../../../../fixtures/heyreach/", import.meta.url);

const ANSWERS = new Map([
  ["/api/public/campaign/GetById", "getCampaign.json"],
  ["/api/public/campaign/GetCampaignsForLead", "getCampaignsForLead.json"],
  ["/api/public/list/GetListsForLead", "getListsForLead.json"],
]);

/** Every request the SDK made, as `METHOD path body`. */
export const requests: string[] = [];

export const fixtureFetch: typeof fetch = (input, init) => {
  const url = new URL(input instanceof Request ? input.url : input);
  const file = ANSWERS.get(url.pathname);

  requests.push(
    [init?.method ?? "GET", url.pathname + url.search, init?.body ?? ""]
      .join(" ")
      .trim()
  );

  return Promise.resolve(
    file === undefined
      ? Response.json({ message: "no fixture" }, { status: 404 })
      : new Response(readFileSync(new URL(file, FIXTURES), "utf-8"), {
          headers: { "content-type": "application/json" },
        })
  );
};
