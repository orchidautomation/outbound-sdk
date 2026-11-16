// Which leads only ever auto-replied, from the replies themselves. A vendor's
// per-lead reply count can include automatic replies (Instantly's does), and
// its lead record says nothing about them, so the replies are read.

import type { Lead } from "../../internal/entities.ts";
import { makeRef } from "../../internal/ref.ts";
import { maskingOf } from "../define.ts";
import type { InsightContext } from "../define.ts";

/** The most replies read to find leads whose replies were all automatic. */
export const AUTO_CHECK_REPLIES = 200;

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
 * nor is a lead none of whose replies were read. Reads at most
 * `AUTO_CHECK_REPLIES` replies, newest first, and nothing when no lead
 * counted replies or the tool cannot list replies. Under a redact that masks
 * addresses with `[redacted]`, every reply naming its lead by address names
 * the same ref, so nothing is matched and the answer is marked partial.
 */
export const autoOnlyRefs = async (
  context: InsightContext,
  campaign: string | null,
  leads: readonly Lead[]
): Promise<ReadonlySet<string>> => {
  const { outbound } = context;

  const replied = leads.filter(
    (lead) => (lead.engagement?.replies ?? 0) > 0 || lead.replied === true
  );

  if (replied.length === 0 || !outbound.capabilities["replies.list"]) {
    return new Set();
  }

  if (addressesMasked(context) && maskingOf(outbound)?.strategy === "mask") {
    context.partial(
      `${ADDRESSES_MASKED} replies were not matched to leads to tell automatic replies from people.`
    );

    return new Set();
  }

  const replies = await context.all(
    campaign === null
      ? outbound.replies.listAll({ max: AUTO_CHECK_REPLIES })
      : outbound
          .campaign(campaign)
          .replies.listAll({ max: AUTO_CHECK_REPLIES }),
    {
      input: null,
      max: AUTO_CHECK_REPLIES,
      what: "replies read to tell automatic replies from people",
    }
  );

  const automatic = new Set<string>();
  const human = new Set<string>();

  for (const reply of replies) {
    if (reply.leadRef !== null) {
      (reply.isAuto === true ? automatic : human).add(reply.leadRef);
    }
  }

  return new Set(
    replied.flatMap((lead) => {
      const refs = refsOf(lead);

      return refs.some((ref) => automatic.has(ref)) &&
        !refs.some((ref) => human.has(ref))
        ? refs
        : [];
    })
  );
};
