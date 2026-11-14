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

/**
 * `mapPage` for a mapper that may skip a row: a row that maps to nothing,
 * such as a block entry with no value, is left out and not returned empty.
 */
export const flatMapPage = <Item>(
  page: RawPage,
  toItems: (raw: JsonObject) => readonly Item[]
): Page<Item> => ({
  items: page.items.flatMap((raw) => toItems(raw)),
  next: page.next,
});
