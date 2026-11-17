// sender_health: the state of every sender, the failing ones first, and
// what each failing sender breaks.

import { z } from "zod";

import type { Sender } from "../internal/entities.ts";
import type { JsonObject } from "../internal/json.ts";
import { plural } from "../internal/numbers.ts";
import { SCREENED_AT_MOST } from "../internal/sender-screen.ts";
import { isFailing, readImpacts } from "./sender-impact.ts";
import type { ToolDefinition } from "./shared.ts";

const healthInput = z.object({
  impact: z
    .boolean()
    .default(true)
    .describe(
      "Read what each disconnected or failing sender breaks: its active campaigns and recent sends. A few requests per failing sender."
    ),
  limit: z
    .number()
    .int()
    .min(1)
    .max(200)
    .default(50)
    .describe("How many senders to list, those needing attention first"),
});

// Failing senders first, then other senders that are not active.
const rank = (sender: Sender): number => {
  if (isFailing(sender)) {
    return 0;
  }

  return sender.status === "active" ? 2 : 1;
};

export const senderHealth: ToolDefinition<z.infer<typeof healthInput>> = {
  description: `The state of each sender (mailbox or LinkedIn seat): address, status, daily limit and warmup. Every sender is checked from the sender list (up to ${SCREENED_AT_MOST}, 1 request per 100). Disconnected or failing senders are listed first, each with impact: the active campaigns it sends for, what it sent in the last 14 days, the day it last sent and its last successful sign-in, each null with a reason in impact.unknown where the vendor does not report it. unhealthy counts the checked senders that are not active and failing those disconnected or failing; total is how many senders exist (null past ${SCREENED_AT_MOST}). meta.complete: false means more senders exist than were checked, limit cut the list or impact was left out for some failing senders, and meta.notes says which.`,
  inputSchema: healthInput,
  name: "sender_health",
  needs: ["senders.list"],
  run: async (outbound, input) => {
    const walk = outbound.senders.listAll({ max: SCREENED_AT_MOST });
    const senders = await walk.toArray();
    const failing = senders.filter((sender) => isFailing(sender));

    const impacts = input.impact
      ? await readImpacts(outbound, failing)
      : { bySender: new Map(), notes: [], requests: 0, skipped: 0 };

    const cut = senders.length > input.limit;

    const notes = [
      ...(walk.meta?.notes ?? []),
      ...(walk.truncated
        ? [
            `More senders exist than the ${senders.length} checked; unhealthy and failing count only those.`,
          ]
        : []),
      ...(cut
        ? [
            `Listed ${plural(input.limit, "sender")} (limit); more were checked.`,
          ]
        : []),
      ...impacts.notes,
    ];

    return {
      data: {
        checked: senders.length,
        failing: failing.length,
        senders: senders
          .toSorted((left, right) => rank(left) - rank(right))
          .slice(0, input.limit)
          .map((sender) => {
            const row: JsonObject = {
              address: sender.address,
              daily_limit: sender.dailyLimit,
              kind: sender.kind,
              name: sender.name,
              sender: sender.ref,
              status: sender.status,
              warmup_enabled: sender.warmup?.enabled ?? null,
              warmup_score: sender.warmup?.score ?? null,
            };

            const impact = impacts.bySender.get(sender.ref);

            if (impact !== undefined) {
              row.impact = impact;
            }

            return row;
          }),
        total: walk.truncated ? null : senders.length,
        unhealthy: senders.filter((sender) => sender.status !== "active")
          .length,
      },
      meta: {
        complete: !walk.truncated && !cut && impacts.skipped === 0,
        evidence: walk.meta?.evidence ?? "exact",
        notes,
        provider: outbound.provider,
        requests: (walk.meta?.requests ?? 0) + impacts.requests,
      },
      next: "Use deliverability_check for each sender's DNS, sign-in and block list status.",
      ok: true,
    };
  },
};
