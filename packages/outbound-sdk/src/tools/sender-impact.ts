// What a failing sender breaks: the active campaigns it sends for, what it
// sent in the last days and when it last sent. sender_health and
// deliverability_check read it for each disconnected or failing sender.

import { mapConcurrent } from "../internal/concurrency.ts";
import type { SenderHealth } from "../internal/entities-account.ts";
import type { MetricRow, Sender } from "../internal/entities.ts";
import { OutboundError } from "../internal/errors.ts";
import type { JsonObject } from "../internal/json.ts";
import { plural } from "../internal/numbers.ts";
import type { OutboundApi } from "../internal/outbound/api.ts";
import { brokenStatus } from "../internal/sender-screen.ts";

/** The days of sends read for each failing sender, today included. */
export const IMPACT_DAYS = 14;

/**
 * Failing senders past this many get no impact, with a note, where each
 * sender's days cost a read of their own.
 */
export const IMPACT_AT_MOST = 10;

/**
 * The same where one call reads many senders' days: each sender then costs
 * only the listing of its campaigns.
 */
export const IMPACT_BATCHED_AT_MOST = 200;

/** Active campaigns named per sender; the count covers them all. */
const CAMPAIGNS_NAMED = 20;

const DAY_MS = 86_400_000;

/** The vendor reports the sender disconnected or failing, or that it cannot sign in. */
export const isFailing = (
  sender: Sender,
  health?: SenderHealth | null
): boolean => brokenStatus(sender) || health?.connected === false;

/** A request cap the caller set stopped the read: retrying stops there again. */
export const isCapStop = (cause: unknown): boolean =>
  OutboundError.is(cause) &&
  cause.code === "RateLimited" &&
  (cause.limit === "call" || cause.limit === "run");

const NO_SIGN_IN_TIME =
  "Not reported: the sender records this adapter reads carry no time of the last successful sign-in.";

interface Read<Value> {
  readonly value: Value | null;
  readonly requests: number;
  /** Why `value` is `null`. */
  readonly reason?: string | undefined;
}

const failed = (cause: unknown, what: string): Read<never> => {
  if (!OutboundError.is(cause) || cause.code === "Unauthorized") {
    throw cause;
  }

  const why = isCapStop(cause)
    ? "the request cap of this call was reached"
    : cause.message;

  return {
    reason: `Not read: ${what} failed (${why}).`,
    requests: 0,
    value: null,
  };
};

interface ActiveCampaigns {
  readonly campaigns: readonly {
    readonly campaign: string;
    readonly name: string;
  }[];
  readonly count: number | null;
}

interface RecentSends {
  readonly from: string;
  readonly to: string;
  readonly sent: number | null;
  readonly last_sent_on: string | null;
}

const activeCampaigns = async (
  outbound: OutboundApi,
  sender: Sender
): Promise<Read<ActiveCampaigns>> => {
  if (outbound.capabilities["campaigns.bySender"] === false) {
    return {
      reason: "Not read: this adapter cannot list a sender's campaigns.",
      requests: 0,
      value: null,
    };
  }

  try {
    const walk = outbound.sender(sender.ref).campaigns.listAll({ max: 100 });
    const campaigns = await walk.toArray();
    const active = campaigns.filter((campaign) => campaign.status === "active");

    return {
      reason: walk.truncated
        ? "More than 100 campaigns use this sender; active counts the first 100."
        : undefined,
      requests: walk.meta?.requests ?? 0,
      value: {
        campaigns: active.slice(0, CAMPAIGNS_NAMED).map((campaign) => ({
          campaign: campaign.ref,
          name: campaign.name,
        })),
        count: walk.truncated ? null : active.length,
      },
    };
  } catch (error) {
    return failed(error, "listing its campaigns");
  }
};

const dayOf = (at: number): string => new Date(at).toISOString().slice(0, 10);

/** Messages and, on LinkedIn, connection requests sent: what a sender does. */
const sentOn = (row: MetricRow): number | null =>
  row.sent === null && row.connectionsSent === null
    ? null
    : (row.sent ?? 0) + (row.connectionsSent ?? 0);

/** What a sender sent from `from` to `to`, from its daily rows. */
const sendsIn = (
  rows: readonly MetricRow[],
  from: string,
  to: string
): Omit<Read<RecentSends>, "requests"> => {
  const days = rows.flatMap((row) => {
    const sent = sentOn(row);

    return row.date === null ||
      row.date < from ||
      row.date > to ||
      sent === null
      ? []
      : [{ date: row.date, sent }];
  });

  const total =
    days.length === 0 ? null : days.reduce((sum, day) => sum + day.sent, 0);

  const lastSent = days
    .flatMap((day) => (day.sent > 0 ? [day.date] : []))
    .toSorted()
    .at(-1);

  let reason: string | undefined;

  if (total === null) {
    reason = `Unknown: the vendor returned no daily sends for this sender from ${from} to ${to}, so it sent nothing then or does not report it.`;
  } else if (lastSent === undefined) {
    reason = `Nothing sent from ${from} to ${to}; an earlier send is not read.`;
  }

  return {
    reason,
    value: { from, last_sent_on: lastSent ?? null, sent: total, to },
  };
};

const NO_DAILY_STATS: Read<never> = {
  reason: "Not read: this adapter has no daily stats for a sender.",
  requests: 0,
  value: null,
};

const hasDailySends = (outbound: OutboundApi): boolean =>
  outbound.capabilities["stats.bySender"] !== false &&
  outbound.capabilities["stats.byDay"] !== false;

/** The adapter reads many senders' days in one call. */
const isBatched = (outbound: OutboundApi): boolean =>
  hasDailySends(outbound) && outbound.capabilities["stats.bySenders"] !== false;

interface Days {
  readonly from: string;
  readonly to: string;
}

/** The last `IMPACT_DAYS` days, today included. */
const rangeOf = (now: number): Days => ({
  from: dayOf(now - (IMPACT_DAYS - 1) * DAY_MS),
  to: dayOf(now),
});

const recentSends = async (
  outbound: OutboundApi,
  sender: Sender,
  now: number
): Promise<Read<RecentSends>> => {
  if (!hasDailySends(outbound)) {
    return NO_DAILY_STATS;
  }

  const { from, to } = rangeOf(now);

  try {
    const result = await outbound
      .sender(sender.ref)
      .stats({ by: "day", from, to });

    return {
      ...sendsIn(result.rows, from, to),
      requests: result.meta.requests,
    };
  } catch (error) {
    return failed(error, "reading its daily sends");
  }
};

interface BatchedSends {
  /** By sender ref. */
  readonly bySender: ReadonlyMap<string, Read<RecentSends>>;
  readonly requests: number;
}

/** Every sender's days in one read, where the adapter reads many at once. */
const batchedSends = async (
  outbound: OutboundApi,
  senders: readonly Sender[],
  now: number
): Promise<BatchedSends> => {
  const { from, to } = rangeOf(now);

  try {
    const result = await outbound.stats({
      by: "day",
      from,
      scope: "sender",
      scopeIds: senders.map((sender) => sender.ref),
      to,
    });

    const rowsOf = new Map<string, MetricRow[]>();

    for (const row of result.rows) {
      rowsOf.set(row.scopeRef, [...(rowsOf.get(row.scopeRef) ?? []), row]);
    }

    return {
      bySender: new Map(
        senders.map((sender) => [
          sender.ref,
          {
            ...sendsIn(rowsOf.get(sender.ref) ?? [], from, to),
            requests: 0,
          },
        ])
      ),
      requests: result.meta.requests,
    };
  } catch (error) {
    const read = failed(error, "reading the daily sends");

    return {
      bySender: new Map(senders.map((sender) => [sender.ref, read])),
      requests: 0,
    };
  }
};

export interface Impact {
  readonly impact: JsonObject;
  readonly requests: number;
}

/**
 * What one failing sender breaks. A count the vendor does not give is
 * `null`, never 0, and `unknown` says why for each `null`.
 */
const impactOf = async (
  outbound: OutboundApi,
  sender: Sender,
  now: number,
  batched: Read<RecentSends> | undefined
): Promise<Impact> => {
  const [campaigns, sends] = await Promise.all([
    activeCampaigns(outbound, sender),
    batched ?? recentSends(outbound, sender, now),
  ]);

  const sendsKey =
    sends.value === null || sends.value.sent === null
      ? "recent_sends"
      : "last_sent_on";

  const unknown = Object.fromEntries([
    ["last_authenticated_at", NO_SIGN_IN_TIME],
    ...(campaigns.reason === undefined
      ? []
      : [["active_campaigns", campaigns.reason]]),
    ...(sends.reason === undefined ? [] : [[sendsKey, sends.reason]]),
  ]);

  return {
    impact: {
      active_campaign_count: campaigns.value?.count ?? null,
      active_campaigns:
        campaigns.value === null
          ? null
          : campaigns.value.campaigns.map((campaign) => ({ ...campaign })),
      last_authenticated_at: null,
      last_sent_on: sends.value?.last_sent_on ?? null,
      recent_sends:
        sends.value === null
          ? null
          : {
              from: sends.value.from,
              sent: sends.value.sent,
              to: sends.value.to,
            },
      unknown,
    },
    requests: campaigns.requests + sends.requests,
  };
};

export interface Impacts {
  /** By sender ref. */
  readonly bySender: ReadonlyMap<string, JsonObject>;
  readonly requests: number;
  readonly notes: readonly string[];
  /** Failing senders left without impact. */
  readonly skipped: number;
}

/**
 * The impact of the first failing senders, in the order given:
 * `IMPACT_BATCHED_AT_MOST` where the adapter reads many senders' days in one
 * call, `IMPACT_AT_MOST` where each sender's days cost a read of their own.
 */
export const readImpacts = async (
  outbound: OutboundApi,
  failing: readonly Sender[],
  now = Date.now()
): Promise<Impacts> => {
  const batched = isBatched(outbound);
  const atMost = batched ? IMPACT_BATCHED_AT_MOST : IMPACT_AT_MOST;
  const chosen = failing.slice(0, atMost);

  const sends =
    batched && chosen.length > 0
      ? await batchedSends(outbound, chosen, now)
      : undefined;

  const read = await mapConcurrent(chosen, async (sender) => ({
    ref: sender.ref,
    ...(await impactOf(outbound, sender, now, sends?.bySender.get(sender.ref))),
  }));

  const skipped = failing.length - chosen.length;

  return {
    bySender: new Map(read.map((entry) => [entry.ref, entry.impact])),
    notes:
      skipped > 0
        ? [
            `Impact (active campaigns, recent sends) was read for the first ${plural(atMost, "failing sender")}; ${skipped} more ${skipped === 1 ? "has" : "have"} none.`,
          ]
        : [],
    requests: read.reduce(
      (sum, entry) => sum + entry.requests,
      sends?.requests ?? 0
    ),
    skipped,
  };
};
