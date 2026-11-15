// What the entries of the Smartlead native catalog share: the reference
// address, the sister services' hosts and the offset paging parameters.

import { inQuery } from "../internal/native.ts";

/** Smartlead's reference pages. */
export const DOCS = "https://api.smartlead.ai/api-reference";

/** The sister services, each on its own host with the same `api_key`. */
export const DELIVERY_URL = "https://smartdelivery.smartlead.ai/api/v1";
export const PROSPECT_URL = "https://prospect-api.smartlead.ai/api/v1";
export const SENDERS_URL = "https://smart-senders.smartlead.ai/api/v1";
export const SERVERS_URL = "https://smartservers.smartlead.ai/api/v1";

/** `limit` and `offset` in the query, for the offset-paged lists. */
export const paged = (limit: string) => ({
  limit: inQuery("number", limit),
  offset: inQuery("number", "Rows to skip."),
});
