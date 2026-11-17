// deliverability_check: whether each sender can deliver, which senders were
// checked and which were not, and what a failing sender breaks.

import { z } from "zod";

import { mapConcurrent } from "../internal/concurrency.ts";
import type { SenderHealth } from "../internal/entities-account.ts";
import type { Sender } from "../internal/entities.ts";
import { OutboundError } from "../internal/errors.ts";
import { plural } from "../internal/numbers.ts";
import type { OutboundApi } from "../internal/outbound/api.ts";
import { listProblemsOf, SCREENED_AT_MOST } from "../internal/sender-screen.ts";
import { isCapStop, isFailing, readImpacts } from "./sender-impact.ts";
import type { ToolDefinition } from "./shared.ts";

/** Without `max_checked`, one request or more each: the senders most likely to have a problem. */
const CHECKED_ONE_BY_ONE = 25;

const checkInput = z.object({
  campaign: z
    .string()
    .min(1)
    .optional()
    .describe("Only the senders attached to this campaign"),
  limit: z
    .number()
    .int()
    .min(1)
    .max(100)
    .default(25)
    .describe(
      "How many senders to list, problems first. Senders past it are still checked and counted."
    ),
  max_checked: z
    .number()
    .int()
    .min(1)
    .max(SCREENED_AT_MOST)
    .optional()
    .describe(
      `The most senders to check in full. Leave out to check every sender where the vendor reads health a page at a time (a few requests per 100 senders), or the ${CHECKED_ONE_BY_ONE} most likely to have a problem where it reads one sender at a time (1 to 3 requests each).`
    ),
});

const DNS_RECORDS = ["spf", "dkim", "dmarc", "mx"] as const;

/** What is wrong with a sender, in plain words. Empty when nothing is. */
const problemsOf = (health: SenderHealth): string[] => {
  const problems = DNS_RECORDS.flatMap((record) =>
    health.dns[record] === false ? [`${record.toUpperCase()} record fails`] : []
  );

  if (health.connected === false) {
    problems.push("the vendor cannot sign in to this sender");
  }

  if (health.blacklisted === true) {
    problems.push("on a block list");
  }

  return [...problems, ...health.issues];
};

const spamRate = (health: SenderHealth): number | null => {
  const spam = health.warmup?.spam ?? null;
  const inbox = health.warmup?.inbox ?? null;

  return spam === null || inbox === null || spam + inbox === 0
    ? null
    : Math.round((spam / (spam + inbox)) * 10_000) / 10_000;
};

type Reason = "cap" | "error" | "unsupported";

const REASONS: readonly Reason[] = ["cap", "unsupported", "error"];

interface Unchecked {
  readonly reason: Reason;
  readonly detail: string;
}

interface Checks {
  readonly health: ReadonlyMap<string, SenderHealth>;
  readonly unchecked: ReadonlyMap<string, Unchecked>;
  readonly requests: number;
}

const reasonOf = (cause: unknown): Unchecked => {
  if (!OutboundError.is(cause) || cause.code === "Unauthorized") {
    throw cause;
  }

  if (isCapStop(cause)) {
    return {
      detail: "the request cap of this call was reached",
      reason: "cap",
    };
  }

  return cause.code === "Unsupported"
    ? { detail: cause.message, reason: "unsupported" }
    : { detail: cause.message, reason: "error" };
};

/** Every sender's health a page at a time, in the order the vendor lists them. */
const checkInPages = async (
  outbound: OutboundApi,
  campaignId: string | undefined,
  senders: readonly Sender[],
  max: number
): Promise<Checks> => {
  const walk = outbound.senderHealth.listAll({ campaignId, max });
  const health = new Map<string, SenderHealth>();
  let stop: Unchecked | undefined;

  try {
    for await (const record of walk) {
      health.set(record.senderRef, record);
    }
  } catch (error) {
    stop = reasonOf(error);
  }

  const missing: Unchecked = stop ?? {
    detail:
      health.size >= max
        ? `max_checked (${max}) was reached`
        : "the vendor returned no health for this sender",
    reason: health.size >= max ? "cap" : "error",
  };

  return {
    health,
    requests: walk.meta?.requests ?? 0,
    unchecked: new Map(
      senders.flatMap((sender) =>
        health.has(sender.ref) ? [] : [[sender.ref, missing] as const]
      )
    ),
  };
};

/** One sender at a time, those whose list entry shows a problem first. */
const checkEach = async (
  outbound: OutboundApi,
  ranked: readonly Sender[],
  max: number
): Promise<Checks> => {
  const results = await mapConcurrent(ranked.slice(0, max), async (sender) => {
    try {
      return { health: await outbound.sender(sender.ref).health(), sender };
    } catch (error) {
      return { sender, unchecked: reasonOf(error) };
    }
  });

  const health = new Map<string, SenderHealth>();
  const unchecked = new Map<string, Unchecked>();
  let requests = 0;

  for (const result of results) {
    if (result.health === undefined) {
      unchecked.set(result.sender.ref, result.unchecked);
    } else {
      health.set(result.sender.ref, result.health);
      requests += result.health.meta.requests;
    }
  }

  for (const sender of ranked.slice(max)) {
    unchecked.set(sender.ref, {
      detail: `max_checked (${max}) was reached`,
      reason: "cap",
    });
  }

  return { health, requests, unchecked };
};

const rowOf = (
  sender: Sender,
  health: SenderHealth | undefined,
  unchecked: Unchecked | undefined
) => {
  const problems = [
    ...listProblemsOf(sender),
    ...(health === undefined ? [] : problemsOf(health)),
  ];

  const base = {
    address: sender.address,
    checked: health !== undefined,
    problems,
    sender: sender.ref,
    status: sender.status,
  };

  if (health === undefined) {
    return {
      problems,
      row: {
        ...base,
        not_checked: {
          detail: unchecked?.detail ?? null,
          reason: unchecked?.reason ?? null,
        },
      },
    };
  }

  return {
    problems,
    row: {
      ...base,
      blacklisted: health.blacklisted,
      checked_at: health.checkedAt,
      connected: health.connected,
      dns: { ...health.dns },
      domain: health.domain,
      warmup_inbox: health.warmup?.inbox ?? null,
      warmup_score: health.warmup?.score ?? null,
      warmup_spam: health.warmup?.spam ?? null,
      warmup_spam_rate: spamRate(health),
    },
  };
};

const countBy = (unchecked: Iterable<Unchecked>): Record<Reason, number> => {
  const counts: Record<Reason, number> = { cap: 0, error: 0, unsupported: 0 };

  for (const entry of unchecked) {
    counts[entry.reason] += 1;
  }

  return counts;
};

const coverageNotes = (
  checked: number,
  screened: number,
  byReason: Record<Reason, number>,
  complete: boolean
): string[] => [
  ...(checked < screened
    ? [
        `Checked ${checked} of ${plural(screened, "sender")} in full (${REASONS.flatMap(
          (reason) =>
            byReason[reason] > 0
              ? [`${byReason[reason]} not checked: ${reason}`]
              : []
        ).join(
          ", "
        )}). Those were screened from the sender list for status and warmup only; with_problems counts what that found. coverage and each row's not_checked say why.`,
      ]
    : []),
  ...(complete
    ? []
    : [
        `More than ${screened} senders exist; those past the first ${screened} were not screened or checked.`,
      ]),
];

export const deliverabilityCheck: ToolDefinition<z.infer<typeof checkInput>> = {
  description: `Whether each sender can deliver: its DNS records (SPF, DKIM, DMARC, MX), whether the vendor can still sign in, block list status and how much warmup mail landed in spam (warmup_spam_rate is warmup_spam of warmup_spam plus warmup_inbox, and checked_at is when the vendor last checked). Every sender (up to ${SCREENED_AT_MOST}) is screened from the sender list, then checked in full: all of them where the vendor reads health a page at a time, otherwise up to max_checked, problems first. coverage counts the senders checked and not checked, and why (cap, unsupported, error); each listed row says whether it was checked. A disconnected or failing sender carries impact: the active campaigns it sends for, what it sent in the last 14 days, the day it last sent and its last successful sign-in, each null with a reason in impact.unknown where the vendor does not report it. senders lists up to limit senders: problems first, then those not checked, then healthy ones; healthy counts every checked sender with no problem. meta.complete: false means a sender was not checked, or limit left out a sender with a problem or not checked, and meta.notes says which. Use it when bounces rise or replies drop. A null means the vendor does not report that check, never that it passed.`,
  inputSchema: checkInput,
  name: "deliverability_check",
  needs: ["senders.health"],
  run: async (outbound, input) => {
    const walk = outbound.senders.listAll({
      campaignId: input.campaign,
      max: SCREENED_AT_MOST,
    });

    const listed = await walk.toArray();

    const ranked = listed.toSorted(
      (left, right) =>
        listProblemsOf(right).length - listProblemsOf(left).length
    );

    const inPages = outbound.capabilities["senders.healthList"] === true;

    const max =
      input.max_checked ?? (inPages ? SCREENED_AT_MOST : CHECKED_ONE_BY_ONE);

    const checks = inPages
      ? await checkInPages(outbound, input.campaign, listed, max)
      : await checkEach(outbound, ranked, max);

    const failing = ranked.filter((sender) =>
      isFailing(sender, checks.health.get(sender.ref))
    );

    const impacts = await readImpacts(outbound, failing);

    const rows = ranked.map((sender) => {
      const entry = rowOf(
        sender,
        checks.health.get(sender.ref),
        checks.unchecked.get(sender.ref)
      );

      const impact = impacts.bySender.get(sender.ref);

      return impact === undefined
        ? entry
        : { ...entry, row: { ...entry.row, impact } };
    });

    // Problems first, then senders not checked, then the healthy ones.
    const weight = (entry: (typeof rows)[number]): number =>
      entry.problems.length * 2 + (entry.row.checked ? 0 : 1);

    const ordered = rows.toSorted(
      (left, right) => weight(right) - weight(left)
    );

    const flagged = ordered.filter(
      (entry) => entry.problems.length > 0 || !entry.row.checked
    ).length;

    const complete = !walk.truncated;
    const byReason = countBy(checks.unchecked.values());
    const cut = flagged > input.limit;

    const notes = [
      ...(walk.meta?.notes ?? []),
      ...coverageNotes(checks.health.size, listed.length, byReason, complete),
      ...impacts.notes,
      ...(cut
        ? [
            `Listed ${input.limit} of ${plural(flagged, "sender")} with a problem or not checked (limit).`,
          ]
        : []),
      ...(!cut && rows.length > input.limit
        ? [
            `Listed ${input.limit} of ${plural(rows.length, "sender")}: every sender with a problem or not checked, then healthy ones; healthy counts the ${rows.length - input.limit} healthy senders past limit.`,
          ]
        : []),
    ];

    return {
      data: {
        checked: checks.health.size,
        coverage: {
          checked: checks.health.size,
          not_checked: checks.unchecked.size,
          not_checked_by_reason: byReason,
          screened: listed.length,
          senders: complete ? listed.length : null,
        },
        failing: failing.length,
        healthy: rows.length - flagged,
        screened: listed.length,
        senders: ordered.slice(0, input.limit).map((entry) => entry.row),
        total: complete ? listed.length : null,
        with_problems: rows.filter((entry) => entry.problems.length > 0).length,
      },
      meta: {
        complete:
          complete &&
          checks.unchecked.size === 0 &&
          impacts.skipped === 0 &&
          !cut,
        evidence: "exact",
        notes,
        provider: outbound.provider,
        requests:
          (walk.meta?.requests ?? 0) + checks.requests + impacts.requests,
      },
      next: "Use sender_health for each sender's status and limits, or campaign_setup to see what a campaign asks of its senders.",
      ok: true,
    };
  },
};
