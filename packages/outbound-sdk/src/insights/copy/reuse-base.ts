// The base copy_reuse divides replies by. The same copy in two campaigns is
// compared only when both rates are divided by the same thing: one campaign
// per lead contacted and the other per message sent would differ for no
// reason but the base.

import type { Campaign } from "../../internal/entities.ts";
import type { MetricCounts } from "../../internal/metrics.ts";
import type { InsightContext } from "../define.ts";
import { total } from "../stats.ts";
import {
  baseIn,
  basesInWords,
  groupBy,
  measure,
  perLead,
  sharedBases,
} from "./shared.ts";
import type { Base, Measured, RateBasis } from "./shared.ts";

/** The base a placement's replies are divided by. */
export type BaseOf = (counts: MetricCounts) => Base;

export const pooled = (
  counts: readonly (MetricCounts | null)[],
  baseOf: BaseOf
) => {
  // Only a use with both counts known enters the pooled rate, so a missing
  // reply count never drags the rate down.
  const measured: Measured[] = counts.flatMap((each) => {
    const one = each === null ? null : measure(each.replied, baseOf(each));

    return one === null || one.rate === null ? [] : [one];
  });

  const replies = total(measured.map((each) => each.count));
  const trials = total(measured.map((each) => each.of));
  const bases = new Set(measured.map((each) => each.basis));
  const [basis = null] = bases.size === 1 ? bases : [];

  return {
    ...measure(replies, { basis, trials }),
    sent: total(counts.map((each) => each?.sent ?? null)),
  };
};

export interface Counted {
  readonly campaign: Campaign;
  readonly counts: MetricCounts;
}

/** Each campaign's own base, or `null` when its variants differ, for the note. */
const basesByCampaign = (counted: readonly Counted[]) =>
  [...groupBy(counted, (each) => each.campaign.ref).values()].flatMap(
    (group) => {
      const [first] = group;
      const bases = new Set(group.map((each) => perLead(each.counts).basis));
      const [basis = null] = bases.size === 1 ? bases : [];

      return first === undefined ? [] : [{ basis, name: first.campaign.name }];
    }
  );

export interface SharedBase {
  readonly baseOf: BaseOf;
  readonly basis: RateBasis | null;
  readonly comparable: boolean;
}

/**
 * One base for every rate: leads contacted when every campaign counts them,
 * otherwise messages sent. Without one they all report, each placement keeps
 * its own and a note says the rates are not compared.
 */
export const sharedBaseOf = (
  context: InsightContext,
  counted: readonly Counted[]
): SharedBase => {
  const shared = sharedBases(
    counted.map((each) => each.counts),
    "lead"
  );

  const { basis } = shared;

  if (!shared.comparable) {
    context.note(
      `The campaigns report different bases (${basesInWords(
        basesByCampaign(counted)
      )}), so their reply rates are not compared: no spread is judged and no best copy is named.`
    );
  }

  return {
    baseOf: basis === null ? perLead : (counts) => baseIn(counts, basis),
    basis,
    comparable: shared.comparable,
  };
};
