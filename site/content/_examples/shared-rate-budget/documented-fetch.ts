// A stand-in for HeyReach: it answers every request with the campaign list
// from HeyReach's documentation (fixtures/heyreach/listCampaigns.json in the
// repository). It is not a live response.
import { readFile } from "node:fs/promises";

const documented = await readFile(
  new URL("../../../../fixtures/heyreach/listCampaigns.json", import.meta.url),
  "utf-8"
);

export const documentedFetch: typeof fetch = () =>
  Promise.resolve(
    new Response(documented, {
      headers: { "content-type": "application/json" },
    })
  );
