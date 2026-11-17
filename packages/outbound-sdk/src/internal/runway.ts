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
 * Where a campaign's leads stand:
 *
 * - `draining`: leads are left to start and new ones started in the window,
 *   so `daysLeft` is how long they last at that pace.
 * - `stalled`: leads are left to start, but none was started in the window,
 *   or the vendor reports no count of leads started, so there is no pace.
 * - `out_of_leads`: every lead was counted and none is left to start.
 * - `unknown`: the leads left to start were not all counted (a cap stopped
 *   the read, or a lead's status is unknown) and none was found.
 */
export type RunwayState = "draining" | "out_of_leads" | "stalled" | "unknown";

export interface Runway {
  readonly state: RunwayState;
  /** Leads not yet started: active ones with no step sent and no contact, or every active lead when the split is unknown. */
  readonly remaining: number;
  /** Active leads partway through the sequence. `null` when the vendor does not say which have started. */
  readonly inSequence: number | null;
  /** New leads started per day. `null` when the vendor reports no daily count of leads started. */
  readonly pace: number | null;
  /**
   * `remaining` divided by `pace`. `null` when the pace is `null` or 0,
   * since no time can be divided out of it, and when `state` is `unknown`.
   * A minimum when the read was not complete.
   */
  readonly daysLeft: number | null;
}

/**
 * The runway of a campaign from its leads split by start, the count of leads
 * of unknown status, whether every lead was read, and the recent pace. The one
 * runway calculation: pipeline_forecast, client_report, campaign_diagnosis and
 * lead_runway all call it.
 */
export const runwayOf = (
  split: ActiveSplit,
  byStatus: Readonly<Pick<Record<LeadStatus, number>, "unknown">>,
  complete: boolean,
  pace: number | null
): Runway => {
  const remaining = leadsToStart(split);
  const moving = pace !== null && pace > 0;
  const base = { inSequence: split.inSequence, pace, remaining };

  if (remaining === 0) {
    const counted = complete && byStatus.unknown === 0;

    return {
      ...base,
      daysLeft: counted && moving ? 0 : null,
      state: counted ? "out_of_leads" : "unknown",
    };
  }

  return moving
    ? { ...base, daysLeft: roundTo(remaining / pace), state: "draining" }
    : { ...base, daysLeft: null, state: "stalled" };
};

/** What lead_runway and client_report read a campaign's leads with, so both count the same leads. */
export const RUNWAY_MAX_LEADS = 5000;

/** The lead status a runway read asks for: only the active leads where the tool can list them alone. */
export const runwayStatus = (capabilities: {
  readonly "leads.byStatus"?: boolean | undefined;
}): "active" | undefined =>
  capabilities["leads.byStatus"] === true ? "active" : undefined;
