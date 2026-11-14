// What the entries of the Instantly native catalog share: the paging
// parameters and the address of a reference page.

import { inQuery } from "../internal/native.ts";

/** The cursor paging every Instantly list shares. */
export const PAGE = {
  limit: inQuery("number", "Page size, 1 to 100."),
  starting_after: inQuery(
    "string",
    "The next_starting_after of the previous page."
  ),
};

/** The reference page of one endpoint, from its path under `api-reference/`. */
export const docs = (page: string): string =>
  `https://developer.instantly.ai/api-reference/${page}`;
