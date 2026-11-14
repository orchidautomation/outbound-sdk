// One page of a vendor listing, between reading it and mapping it.

import type { Page } from "./adapter.ts";
import type { Json, JsonObject } from "./json.ts";

/** The rows of one vendor page as they came, and where the next page starts. */
export interface RawPage {
  readonly items: readonly JsonObject[];
  readonly next?: Json | undefined;
}

/** Maps each row of a vendor page to a record and keeps the page's cursor. */
export const mapPage = <Item>(
  page: RawPage,
  toItem: (raw: JsonObject) => Item
): Page<Item> => ({
  items: page.items.map((raw) => toItem(raw)),
  next: page.next,
});
