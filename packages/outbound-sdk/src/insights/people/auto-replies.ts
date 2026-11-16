// Which leads only ever auto-replied, from the replies themselves. A vendor's
// per-lead reply count can include automatic replies (Instantly's does), and
// its lead record says nothing about them, so the replies are read.

import type { Lead, Reply } from "../../internal/entities.ts";
import { makeRef } from "../../internal/ref.ts";
import { maskingOf } from "../define.ts";
import type { InsightContext } from "../define.ts";

/** The start of a note for a check redact keeps from running. */
export const ADDRESSES_MASKED =
  "The redact plugin masks email addresses, which a reply can name its lead by, so";

/**
 * `true` when the redact plugin masks email addresses. A reply can name its
 * lead by address (Instantly's do), and a masked address cannot be read back
 * as a lead.
 */
export const addressesMasked = (context: InsightContext): boolean =>
  maskingOf(context.outbound)?.fields.includes("email") ?? false;

/** The start of a note for a check redact keeps from running. */
export const ADDRESSES_MASKED =
  "The redact plugin masks email addresses, which a reply can name its lead by, so";

/**
 * `true` when the redact plugin masks email addresses. A reply can name its
 * lead by address (Instantly's do), and a masked address cannot be read back
 * as a lead.
 */
export const addressesMasked = (context: InsightContext): boolean =>
  maskingOf(context.outbound)?.fields.includes("email") ?? false;

/** A lead's own ref and, when it has an address, the ref a reply may name it by. */
export const refsOf = (lead: Lead): string[] =>
  lead.email === null
    ? [lead.ref]
    : [lead.ref, makeRef(lead.provider, lead.workspaceId, lead.email)];

/**
 * The refs of leads whose every reply read is flagged automatic, by the
 * vendor or by a fixed rule. A lead with one reply not flagged is not in it,
 * nor is a lead none of whose replies were read.
 */
export const autoOnlyRefs = (
  replies: readonly Reply[],
  leads: readonly Lead[]
): ReadonlySet<string> => {
  const automatic = new Set<string>();
  const human = new Set<string>();

  for (const reply of replies) {
    if (reply.leadRef !== null) {
      (reply.isAuto === true ? automatic : human).add(reply.leadRef);
    }
  }

  return new Set(
    leads.flatMap((lead) => {
      const refs = refsOf(lead);

      return refs.some((ref) => automatic.has(ref)) &&
        !refs.some((ref) => human.has(ref))
        ? refs
        : [];
    })
  );
};
