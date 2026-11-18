// The lead behind each email. An email names its lead by address only
// (`lead_id` is documented "(if any)" and was absent live), and one address
// is one lead per campaign, so the ids are looked up by address and matched
// by campaign: one `POST /leads/list` per 100 addresses on a page.

import type { AdapterContext } from "../internal/adapter.ts";
import { emailAddress, text } from "../internal/json.ts";
import type { JsonObject } from "../internal/json.ts";
import { PAGE_SIZE } from "./capabilities.ts";
import type { InstantlyClient } from "./client.ts";
import { leadAddressOf, leadIdKey } from "./map-lead.ts";
import type { LeadIds } from "./map-lead.ts";
import { listEnvelope } from "./map.ts";

/** Every lead with one of `addresses`, as address, campaign and id. */
const leadsWith = async (
  client: InstantlyClient,
  ctx: AdapterContext,
  addresses: readonly string[]
): Promise<{ address: string; campaign: string | null; id: string }[]> => {
  const found: { address: string; campaign: string | null; id: string }[] = [];

  let after: string | undefined;

  do {
    const body: JsonObject = { contacts: [...addresses], limit: PAGE_SIZE };

    if (after !== undefined) {
      body.starting_after = after;
    }

    const envelope = listEnvelope(
      // oxlint-disable-next-line no-await-in-loop -- each page's cursor comes from the one before.
      await client.post(ctx, "/leads/list", body),
      client.identity.provider,
      "/leads/list"
    );

    for (const item of envelope.items) {
      const address = emailAddress(item.email);
      const id = text(item.id);

      if (address !== null && id !== null && addresses.includes(address)) {
        found.push({ address, campaign: text(item.campaign), id });
      }
    }

    // Instantly sends a cursor on a last page too, so a short page ends it.
    after = envelope.items.length >= PAGE_SIZE ? envelope.next : undefined;
  } while (after !== undefined);

  return found;
};

/**
 * The lead ids of the emails that name their lead by address only. An
 * address with one lead also stands for an email that names no campaign.
 */
export const leadIdsFor = async (
  client: InstantlyClient,
  ctx: AdapterContext,
  items: readonly JsonObject[]
): Promise<LeadIds> => {
  const addresses = [
    ...new Set(
      items.flatMap((item) =>
        text(item.lead_id) === null ? (leadAddressOf(item) ?? []) : []
      )
    ),
  ];

  const ids = new Map<string, string>();
  const perAddress = new Map<string, Set<string>>();

  for (let at = 0; at < addresses.length; at += PAGE_SIZE) {
    // oxlint-disable-next-line no-await-in-loop -- one lookup at a time keeps the rate budget even.
    const leads = await leadsWith(
      client,
      ctx,
      addresses.slice(at, at + PAGE_SIZE)
    );

    for (const { address, campaign, id } of leads) {
      ids.set(leadIdKey(address, campaign), id);
      perAddress.set(address, (perAddress.get(address) ?? new Set()).add(id));
    }
  }

  for (const [address, found] of perAddress) {
    const [only] = found;

    if (found.size === 1 && only !== undefined) {
      ids.set(leadIdKey(address, null), only);
    }
  }

  return ids;
};

/** The ids of one known lead's emails: no lookup is needed. */
export const oneLead = (
  address: string,
  campaign: string | null,
  id: string
): LeadIds =>
  new Map([
    [leadIdKey(address, campaign), id],
    [leadIdKey(address, null), id],
  ]);
