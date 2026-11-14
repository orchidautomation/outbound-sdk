// Helpers the Smartlead read modules share: page sizes, path segments, the
// campaign list and the lead category names.

import type { AdapterContext } from "../internal/adapter.ts";
import { OutboundError } from "../internal/errors.ts";
import {
  isJsonObject,
  list,
  objects,
  stringMap,
  text,
} from "../internal/json.ts";
import type { Json, JsonObject } from "../internal/json.ts";
import { PAGE_SIZE } from "./capabilities.ts";
import type { SmartleadClient } from "./client.ts";
import {
  categoriesFromJson,
  categoriesToJson,
  toCategoryMap,
} from "./map-messages.ts";
import { unwrap } from "./map.ts";
import type { LeadCategories } from "./map.ts";

export const pageSize = (limit: number | undefined, max = PAGE_SIZE): number =>
  Math.min(limit ?? max, max);

export const segment = (id: string): string => encodeURIComponent(id);

/** The ids in a cursor or a vendor list, as strings. */
export const idList = (value: Json | undefined): string[] =>
  list(value).flatMap((id) => text(id) ?? []);

export const providerError = (
  client: SmartleadClient,
  message: string
): OutboundError =>
  new OutboundError("Provider", message, {
    provider: client.identity.provider,
  });

/** The payload of an endpoint that returns one object, bare or wrapped. */
export const objectOf = (
  client: SmartleadClient,
  body: Json,
  what: string
): JsonObject => {
  const payload = unwrap(body);

  if (!isJsonObject(payload)) {
    throw providerError(client, `Smartlead returned no object for ${what}`);
  }

  return payload;
};

// `GET /campaigns/` returns every campaign at once: no pages, no filters.
export const campaignList = async (
  client: SmartleadClient,
  ctx: AdapterContext
): Promise<JsonObject[]> =>
  objects(
    unwrap(
      await client.get(ctx, "/campaigns/", { query: { include_tags: true } })
    )
  );

export const campaignIds = async (
  client: SmartleadClient,
  ctx: AdapterContext
): Promise<string[]> => {
  const campaigns = await campaignList(client, ctx);

  return campaigns.flatMap((campaign) => text(campaign.id) ?? []);
};

export interface OffsetPage {
  readonly rows: JsonObject[];
  readonly next: number | undefined;
}

// The offset-paged lists (mailboxes, lead lists, the block list) report no
// total and no marker: a full page means there may be more.
export const offsetPage = async (
  client: SmartleadClient,
  ctx: AdapterContext,
  path: string,
  page: { readonly limit: number; readonly offset: number }
): Promise<OffsetPage> => {
  const rows = objects(unwrap(await client.get(ctx, path, { query: page })));

  return {
    next: rows.length === page.limit ? page.offset + page.limit : undefined,
    rows,
  };
};

/**
 * The lead categories, read from `GET /leads/fetch-categories` once per walk
 * and then carried in the cursor.
 */
export const leadCategories = async (
  client: SmartleadClient,
  ctx: AdapterContext,
  next: Json | undefined
): Promise<LeadCategories> => {
  if (isJsonObject(next)) {
    return {
      meanings: categoriesFromJson(next.meanings),
      names: stringMap(next.categories),
    };
  }

  const body = unwrap(await client.get(ctx, "/leads/fetch-categories"));

  return {
    meanings: toCategoryMap(body),
    names: Object.fromEntries(
      objects(body).flatMap((category) => {
        const id = text(category.id);
        const name = text(category.name);

        return id === null || name === null ? [] : [[id, name] as const];
      })
    ),
  };
};

/** The categories as they travel in a lead cursor. */
export const categoriesCursor = (categories: LeadCategories): JsonObject => ({
  categories: { ...categories.names },
  meanings: categoriesToJson(categories.meanings),
});
