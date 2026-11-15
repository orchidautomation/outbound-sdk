// A lead's status mixes two questions: where the lead is in the sequence,
// and what came back from it. A lead can be finished and have replied. The
// two are kept apart here, and `status` is the one headline made from them
// the same way for every vendor.

import type { Lead, LeadProgress } from "./entities.ts";

export interface LeadOutcome {
  /** `true` once the lead replied. `null` when the vendor does not say. */
  readonly replied: boolean | null;
  readonly bounced: boolean | null;
  readonly unsubscribed: boolean | null;
}

/**
 * The four status fields of a lead. `status` is the outcome when one is
 * known, in the order unsubscribed, bounced, replied, and the progress
 * otherwise.
 */
export const leadStanding = (
  progress: LeadProgress,
  outcome: LeadOutcome
): Pick<
  Lead,
  "bounced" | "progress" | "replied" | "status" | "unsubscribed"
> => {
  const headline = (): Lead["status"] => {
    if (outcome.unsubscribed === true) {
      return "unsubscribed";
    }

    if (outcome.bounced === true) {
      return "bounced";
    }

    return outcome.replied === true ? "replied" : progress;
  };

  return { ...outcome, progress, status: headline() };
};
