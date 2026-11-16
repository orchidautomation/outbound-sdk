// Lead runway: how many days a campaign's leads last at its recent pace. One
// definition, so lead_runway and pipeline_forecast give the same answer for
// the same campaign and window.
//
// The pace is new leads started per day: the daily `contacted` count, which
// each adapter maps to leads whose sequence started that day. Emails sent is
// never a stand-in: most sends are follow-ups to leads already in sequence.
// The leads it divides are the active ones not yet started; a lead partway
// through the sequence needs no new contact.

import type { Lead, LeadStatus } from "./entities.ts";

const DAY_MS = 86_400_000;
const PLACES = 10_000;

const roundTo = (value: number): number => Math.round(value * PLACES) / PLACES;

const dayOf = (time: number): string =>
  new Date(time).toISOString().slice(0, 10);

/** Inclusive `YYYY-MM-DD` days. */
export interface PaceWindow {
  readonly from: string;
  readonly to: string;
}

/** The `days` complete UTC days that end yesterday; today is not over. */
export const paceWindow = (now: number, days: number): PaceWindow => ({
  from: dayOf(now - days * DAY_MS),
  to: dayOf(now - DAY_MS),
});

/**
 * New leads started per day: the known daily `contacted` counts added up and
 * divided by `days`. A day with no row counts as none started. `null` when no
 * row reports `contacted`.
 */
export const newLeadsPerDay = (
  rows: readonly { readonly contacted: number | null }[],
  days: number
): number | null => {
  const known = rows.flatMap((row) =>
    row.contacted === null ? [] : [row.contacted]
  );

  return known.length === 0
    ? null
    : roundTo(known.reduce((sum, value) => sum + value, 0) / days);
};

/** The active leads, split by whether their sequence has started. */
export interface ActiveSplit {
  readonly active: number;
  /**
   * Active leads with no step sent and no contact yet. `null` when the vendor
   * reports neither for any lead read, so started and unstarted look alike.
   */
  readonly notStarted: number | null;
  /** Active leads with a step sent or a contact time. `null` with `notStarted`. */
  readonly inSequence: number | null;
}

const started = (lead: Lead): boolean =>
  lead.engagement !== null &&
  (lead.engagement.stepIndex !== null ||
    lead.engagement.lastContactedAt !== null);

/**
 * Splits the active leads. A vendor that reports a lead's last step or last
 * contact reports it on some lead once the campaign has sent, so when no lead
 * read has either, the split is unknown rather than "none started".
 */
export const splitActive = (leads: readonly Lead[]): ActiveSplit => {
  const active = leads.filter((lead) => lead.status === "active");
  const reported = leads.some(started);
  const inSequence = active.filter(started).length;

  return reported
    ? {
        active: active.length,
        inSequence,
        notStarted: active.length - inSequence,
      }
    : { active: active.length, inSequence: null, notStarted: null };
};

/** The leads runway divides: those not yet started, or every active lead when the split is unknown. */
export const leadsToStart = (split: ActiveSplit): number =>
  split.notStarted ?? split.active;

/**
 * Days until no lead is left to start: `leadsToStart` divided by the pace.
 * `0` when every lead was read, none has an unknown status and none is left
 * to start. `null` when the count is unknown (`complete` false, or a lead's
 * status unknown) and none was found, or when some are left with no pace.
 */
export const runwayDays = (
  split: ActiveSplit,
  byStatus: Readonly<Pick<Record<LeadStatus, number>, "unknown">>,
  complete: boolean,
  pace: number | null
): number | null => {
  const left = leadsToStart(split);

  if (left === 0) {
    return complete && byStatus.unknown === 0 ? 0 : null;
  }

  return pace === null || pace <= 0 ? null : roundTo(left / pace);
};
