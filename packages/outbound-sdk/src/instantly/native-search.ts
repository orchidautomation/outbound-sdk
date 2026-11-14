// Creator search and local business search.
// Each entry is one read Instantly documents; docs/coverage/instantly.md lists them all.

import { defineNative } from "../internal/native.ts";
import { LOCAL_FILTERS_LANE, LOCAL_SEARCH_LANE } from "./capabilities.ts";
import {
  docs,
  inBody,
  inBodyRequired,
  inPath,
  inQuery,
  inQueryRequired,
} from "./native-params.ts";

export const SEARCH_READS = defineNative({
  creatorOutreachBatch: {
    description:
      "A creator list and the progress of its last conversion into leads.",
    docs: docs("creator/get-a-creator-outreach-batch"),
    method: "GET",
    params: {
      id: inPath("The batch."),
    },
    path: "/creator-search/outreach-batches/{id}",
  },
  creatorSearchAllowance: {
    description:
      "The free creator search pages left today and the price after them.",
    docs: docs(
      "creator/get-the-free-creator-search-pages-left-today-and-the-price-after-them"
    ),
    method: "GET",
    path: "/creator-search/search-allowance",
  },
  creatorSearchCapabilities: {
    description: "What creator search supports and what enrichment costs.",
    docs: docs(
      "creator/get-what-creator-search-currently-supports-and-what-enrichment-costs"
    ),
    method: "GET",
    path: "/creator-search/capabilities",
  },
  creatorSearchDictionaries: {
    description:
      "The ids of the languages, interests, brands and audiences a creator search can filter on.",
    docs: docs("creator/get-creator-search-dictionaries"),
    method: "GET",
    params: {
      platform: inQueryRequired("string", "instagram, tiktok or youtube."),
      query: inQuery("string", "Text to find."),
    },
    path: "/creator-search/dictionaries",
  },
  creatorSearchLocations: {
    description: "The places a creator search can filter on.",
    docs: docs("creator/get-creator-search-locations"),
    method: "GET",
    params: {
      platform: inQueryRequired("string", "instagram, tiktok or youtube."),
      query: inQueryRequired("string", "Text to find in a place name."),
    },
    path: "/creator-search/locations",
  },
  localBusinessConversion: {
    description:
      "The progress of a job that turns local businesses into leads.",
    docs: docs("localbusiness/read-a-local-business-convert-job"),
    method: "GET",
    params: {
      id: inPath("The job."),
    },
    path: "/local-business-search/convert/{id}",
  },
  localBusinessFilters: {
    description:
      "The search filters a sentence such as dentists in Austin stands for.",
    docs: docs(
      "localbusiness/turn-a-sentence-into-local-business-search-filters"
    ),
    lane: LOCAL_FILTERS_LANE,
    method: "POST",
    params: {
      input: inBodyRequired("string", "The sentence."),
    },
    path: "/local-business-search/ai-filters",
  },
  localBusinessPlaces: {
    description: "The cities a local business search can use as its location.",
    docs: docs("localbusiness/suggest-cities-for-a-local-business-search"),
    method: "GET",
    params: {
      q: inQueryRequired("string", "Text to find in a city name."),
    },
    path: "/local-business-search/places",
  },
  localBusinessSearch: {
    description:
      "Local businesses by category and place. Searching is free; emails are not shown.",
    docs: docs("localbusiness/search-local-businesses"),
    lane: LOCAL_SEARCH_LANE,
    method: "POST",
    params: {
      filters: inBodyRequired(
        "json",
        "A category, query or name, and a location."
      ),
      page_size: inBody("number", "Businesses per page, 1 to 25."),
    },
    path: "/local-business-search/search",
  },
});
