// Small request helpers the HeyReach readers share.

import { OutboundError } from "../internal/errors.ts";
import { isNumber } from "../internal/json.ts";
import type { Json } from "../internal/json.ts";
import { PAGE_SIZE } from "./capabilities.ts";
import type { HeyReachClient } from "./client.ts";

/** The caller's page size, held to what the endpoint allows. */
export const pageSize = (limit: number | undefined, max = PAGE_SIZE): number =>
  Math.min(limit ?? max, max);

/** Lists page by offset, and `next` is the offset of the next page. */
export const offsetOf = (next: Json | undefined): number =>
  isNumber(next) ? next : 0;

// Campaign, list and account ids are integers, and JSON bodies need them as
// numbers.
export const numericId = (
  client: HeyReachClient,
  id: string,
  what: string
): number => {
  if (!/^\d+$/u.test(id)) {
    throw new OutboundError(
      "Invalid",
      `HeyReach ${what} ids are whole numbers, got "${id}"`,
      { provider: client.identity.provider }
    );
  }

  return Number(id);
};
