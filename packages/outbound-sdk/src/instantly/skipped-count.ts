// A campaign's skipped leads (status -3), for its progress. The per-campaign
// report has no skipped count, so the leads Instantly has not contacted are
// listed, `POST /leads/list` with `filter: "FILTER_VAL_NOT_CONTACTED"`, and
// those with status -3 are counted. A skipped lead was never sent to, so it
// is among them (OUT-100, OUT-175), and that listing is far shorter than
// every lead.

import type { AdapterContext } from "../internal/adapter.ts";
import { count } from "../internal/json.ts";
import type { JsonObject } from "../internal/json.ts";
import { plural } from "../internal/numbers.ts";
import { PAGE_SIZE, SKIPPED_PAGES_AT_MOST } from "./capabilities.ts";
import type { InstantlyClient } from "./client.ts";
import { listEnvelope } from "./map.ts";

const SKIPPED = -3;

/**
 * The campaign's leads with status -3, or `null`, with a note, when the
 * listing is longer than `SKIPPED_PAGES_AT_MOST` pages: a count stopped part
 * way is only a minimum, and is never given as the count.
 */
export const countSkipped = async (
  client: InstantlyClient,
  ctx: AdapterContext,
  campaignId: string
): Promise<number | null> => {
  let skipped = 0;
  let pages = 0;
  let after: string | undefined;

  do {
    if (pages === SKIPPED_PAGES_AT_MOST) {
      ctx.note(
        `skipped is null: the campaign has more than ${plural(SKIPPED_PAGES_AT_MOST * PAGE_SIZE, "lead")} Instantly has not contacted, the most read to count its skipped leads, and at least ${plural(skipped, "lead")} among those read ${skipped === 1 ? "was" : "were"} skipped (status -3).`
      );

      return null;
    }

    const body: JsonObject = {
      campaign: campaignId,
      filter: "FILTER_VAL_NOT_CONTACTED",
      limit: PAGE_SIZE,
    };

    if (after !== undefined) {
      body.starting_after = after;
    }

    const envelope = listEnvelope(
      // oxlint-disable-next-line no-await-in-loop -- each page's cursor comes from the one before.
      await client.post(ctx, "/leads/list", body),
      client.identity.provider,
      "/leads/list"
    );

    pages += 1;
    skipped += envelope.items.filter(
      (item) => count(item.status) === SKIPPED
    ).length;

    // Instantly sends a cursor on a last page too, so a short page ends it.
    after = envelope.items.length >= PAGE_SIZE ? envelope.next : undefined;
  } while (after !== undefined);

  return skipped;
};
