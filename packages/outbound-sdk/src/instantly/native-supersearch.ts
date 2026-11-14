// SuperSearch: enrichment of lists and campaigns, saved searches and company lists.
// Each entry is one read Instantly documents; site/content/docs/coverage/instantly.mdx lists them all.

import {
  defineNative,
  inBody,
  inBodyRequired,
  inPath,
  inQuery,
  inQueryRequired,
} from "../internal/native.ts";
import { docs, PAGE } from "./native-params.ts";

export const SUPERSEARCH_READS = defineNative({
  aiEnrichmentsInProgress: {
    description: "The AI enrichment jobs still running for a list or campaign.",
    docs: docs("supersearchenrichment/get-ai-enrichment-for-resource"),
    method: "GET",
    params: {
      limit: inQuery("number", "How many jobs to return."),
      offset: inQuery("number", "How many jobs to skip."),
      resource_id: inPath("The list or campaign."),
    },
    path: "/supersearch-enrichment/ai/{resource_id}/in-progress",
  },
  companyList: {
    description: "One company list and how far its build is.",
    docs: docs("companylist/get-company-list-status"),
    method: "GET",
    params: {
      company_list_id: inPath("The company list."),
    },
    path: "/supersearch-enrichment/company-lists/{company_list_id}",
  },
  companyListCompanies: {
    description: "The companies in a company list.",
    docs: docs("companylist/list-company-list-members"),
    method: "GET",
    params: {
      ...PAGE,
      company_list_id: inPath("The company list."),
      cursor: inQuery("string", "The old name of starting_after."),
    },
    path: "/supersearch-enrichment/company-lists/{company_list_id}/companies",
  },
  companyListFilterOptions: {
    description: "The values a company-list filter accepts.",
    docs: docs(
      "companylist/get-remote-filter-options-for-a-catalog-backed-company-list-filter"
    ),
    method: "GET",
    params: {
      catalog_id: inQueryRequired("string", "The filter's catalog."),
      limit: inQuery("number", "How many values, 1 to 500."),
      q: inQuery("string", "Text to find in a value."),
    },
    path: "/supersearch-enrichment/company-lists/filter-options",
  },
  companyListRecipes: {
    description: "The ready-made recipes for building a company list.",
    docs: docs("companylist/list-company-list-recipes"),
    method: "GET",
    path: "/supersearch-enrichment/company-lists/recipes",
  },
  companyListSources: {
    description: "The sources a company list can be built from.",
    docs: docs("companylist/list-company-list-sources"),
    method: "GET",
    path: "/supersearch-enrichment/company-lists/sources",
  },
  companyLists: {
    description: "The company lists the workspace built.",
    docs: docs("companylist/list-company-lists"),
    method: "GET",
    params: {
      ...PAGE,
      cursor: inQuery("string", "The old name of starting_after."),
      search: inQuery("string", "Text to find in the name."),
    },
    path: "/supersearch-enrichment/company-lists",
  },
  enrichment: {
    description: "The enrichment settings and progress of a list or campaign.",
    docs: docs("supersearchenrichment/get-enrichment-for-resource"),
    method: "GET",
    params: {
      resource_id: inPath("The list or campaign."),
    },
    path: "/supersearch-enrichment/{resource_id}",
  },
  enrichmentHistory: {
    description: "The enrichment runs of a list or campaign, newest first.",
    docs: docs("supersearchenrichment/get-enrichment-history"),
    method: "GET",
    params: {
      limit: inQuery("number", "How many entries to return."),
      offset: inQuery("number", "How many entries to skip."),
      resource_id: inPath("The list or campaign."),
    },
    path: "/supersearch-enrichment/history/{resource_id}",
  },
  enrichmentProviders: {
    description:
      "Every data provider an enrichment can call, with its actions and credit cost.",
    docs: docs(
      "supersearchenrichment/returns-the-full-integration-provider-registry"
    ),
    method: "GET",
    path: "/supersearch-enrichment/integrations/providers",
  },
  savedSearch: {
    description: "One saved SuperSearch query.",
    docs: docs("supersearchenrichment/get-a-saved-search"),
    method: "GET",
    params: {
      id: inPath("The saved search."),
    },
    path: "/supersearch-enrichment/saved-searches/{id}",
  },
  savedSearches: {
    description: "The workspace's saved SuperSearch queries, newest first.",
    docs: docs("supersearchenrichment/list-saved-searches"),
    method: "GET",
    params: {
      ...PAGE,
      search: inQuery("string", "Text to find in the name."),
    },
    path: "/supersearch-enrichment/saved-searches",
  },
  superSearchLeadCount: {
    description:
      "How many leads match a SuperSearch query. Nothing is enriched.",
    docs: docs("supersearchenrichment/count-leads-from-supersearch"),
    method: "POST",
    params: {
      search_filters: inBodyRequired("json", "The SuperSearch filters."),
      show_one_lead_per_company: inBody(
        "boolean",
        "Count one lead per company."
      ),
      skip_owned_leads: inBody(
        "boolean",
        "Leave out leads the workspace already has."
      ),
    },
    path: "/supersearch-enrichment/count-leads-from-supersearch",
  },
  superSearchLeadPreview: {
    description:
      "A sample of the leads that match a SuperSearch query. Nothing is enriched.",
    docs: docs("supersearchenrichment/preview-leads-from-supersearch"),
    method: "POST",
    params: {
      search_filters: inBodyRequired("json", "The SuperSearch filters."),
      show_one_lead_per_company: inBody(
        "boolean",
        "Return one lead per company."
      ),
      skip_owned_leads: inBody(
        "boolean",
        "Leave out leads the workspace already has."
      ),
    },
    path: "/supersearch-enrichment/preview-leads-from-supersearch",
  },
  superSearchSignalKeywords: {
    description:
      "The most common keywords of a signal category over the last 90 days.",
    docs: docs("supersearchenrichment/facet-keywords-for-a-signal-category"),
    method: "POST",
    params: {
      category: inBodyRequired(
        "string",
        "The signal category, for example linkedin_post_contact."
      ),
      field: inBodyRequired("string", "The keyword field to count."),
      limit: inBody("number", "How many keywords, 1 to 100."),
      prefix: inBody("string", "Only keywords that start with this."),
    },
    path: "/supersearch-enrichment/signal-keywords-facet",
  },
});
