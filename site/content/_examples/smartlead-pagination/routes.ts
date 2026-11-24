// The Smartlead reads this page makes, answered from fixtures/smartlead/.
import { file } from "../_shared/fixture-fetch.ts";
import type { Route } from "../_shared/fixture-fetch.ts";

// A campaign's leads page by `offset` in the query; any offset above 0 gets
// the fixture's last page.
const leads = (url: URL): string =>
  Number(url.searchParams.get("offset") ?? 0) > 0
    ? "listCampaignLeads.page2.json"
    : "listCampaignLeads.json";

export const ROUTES: readonly Route[] = [
  {
    fixture: file("listCampaigns.json"),
    method: "GET",
    path: /^\/api\/v1\/campaigns\/$/u,
  },
  // The lead categories, to name each lead's label.
  {
    fixture: file("listLeadCategories.json"),
    method: "GET",
    path: /^\/api\/v1\/leads\/fetch-categories$/u,
  },
  {
    fixture: leads,
    method: "GET",
    path: /^\/api\/v1\/campaigns\/\d+\/leads$/u,
  },
];
