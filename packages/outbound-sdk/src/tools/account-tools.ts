// Tools about how the account is set up, not how it is performing: a
// campaign's settings, each sender's deliverability and the saved lead lists.

import { z } from "zod";

import type { SenderHealth } from "../internal/entities-account.ts";
import type { Json } from "../internal/json.ts";
import type { ToolDefinition } from "./shared.ts";

const setupInput = z.object({
  campaign: z.string().min(1).describe("The campaign's ref or id"),
});

export const campaignSetup: ToolDefinition<z.infer<typeof setupInput>> = {
  description:
    "How one campaign is set up to send: its sending windows and timezone, daily caps, the gap between sends, open and click tracking, and whether a reply stops the sequence. Use it to explain low volume or missing open data. A null means the vendor does not report that setting.",
  inputSchema: setupInput,
  name: "campaign_setup",
  needs: [],
  run: async (outbound, input) => {
    const settings = await outbound.campaign(input.campaign).settings();

    return {
      data: {
        campaign: settings.campaignRef,
        daily_limit: settings.dailyLimit,
        daily_new_leads: settings.dailyNewLeads,
        end_date: settings.endDate,
        gap_minutes: settings.gapMinutes,
        plain_text: settings.plainText,
        schedule: settings.schedule.map((window) => ({ ...window })),
        start_date: settings.startDate,
        stop_on_auto_reply: settings.stopOnAutoReply,
        stop_on_reply: settings.stopOnReply,
        track_clicks: settings.tracking.clicks,
        track_opens: settings.tracking.opens,
      },
      meta: {
        evidence: settings.meta.evidence,
        provider: outbound.provider,
        requests: settings.meta.requests,
      },
      next: "Use campaign_trend to see whether volume matches these caps, or deliverability_check for the senders.",
      ok: true,
    };
  },
};

const deliverabilityInput = z.object({
  campaign: z
    .string()
    .min(1)
    .optional()
    .describe("Only the senders attached to this campaign"),
  limit: z
    .number()
    .int()
    .min(1)
    .max(25)
    .default(10)
    .describe("How many senders to check. One or more vendor requests each."),
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

export const deliverabilityCheck: ToolDefinition<
  z.infer<typeof deliverabilityInput>
> = {
  description:
    "Whether each sender can deliver: its DNS records (SPF, DKIM, DMARC, MX), whether the vendor can still sign in, block list status, and how much warmup mail landed in spam. Senders with a problem are listed first. Use it when bounces rise or replies drop. A null means the vendor does not report that check.",
  inputSchema: deliverabilityInput,
  name: "deliverability_check",
  needs: [],
  run: async (outbound, input) => {
    const senders = await outbound.senders
      .listAll({ campaignId: input.campaign, max: input.limit })
      .toArray();

    const rows: { readonly problems: string[]; readonly row: Json }[] = [];
    let requests = 1;

    for (const sender of senders) {
      // oxlint-disable-next-line no-await-in-loop -- one sender at a time keeps the rate budget predictable.
      const health = await outbound.sender(sender.ref).health();
      const problems = problemsOf(health);
      requests += health.meta.requests;
      rows.push({
        problems,
        row: {
          address: sender.address,
          blacklisted: health.blacklisted,
          checked_at: health.checkedAt,
          connected: health.connected,
          dns: { ...health.dns },
          domain: health.domain,
          problems,
          sender: sender.ref,
          status: sender.status,
          warmup_score: health.warmup?.score ?? null,
          warmup_spam_rate: spamRate(health),
        },
      });
    }

    const ordered = rows.toSorted(
      (left, right) => right.problems.length - left.problems.length
    );

    return {
      data: {
        senders: ordered.map((entry) => entry.row),
        with_problems: rows.filter((entry) => entry.problems.length > 0).length,
      },
      meta: { evidence: "exact", provider: outbound.provider, requests },
      next: "Use sender_health for each sender's sending results, or campaign_setup to see what a campaign asks of its senders.",
      ok: true,
    };
  },
};

const listsInput = z.object({
  limit: z.number().int().min(1).max(100).default(25),
});

export const audienceLists: ToolDefinition<z.infer<typeof listsInput>> = {
  description:
    "The saved lead lists on the account with how many records each holds. Use it to see what audiences exist before asking about one campaign's leads.",
  inputSchema: listsInput,
  name: "audience_lists",
  needs: [],
  run: async (outbound, input) => {
    const walk = outbound.lists.listAll({ max: input.limit });
    const lists = await walk.toArray();

    return {
      data: {
        lists: lists.map((list) => ({
          created_at: list.createdAt,
          kind: list.kind,
          list: list.ref,
          name: list.name,
          size: list.size,
        })),
      },
      meta: {
        evidence: walk.meta?.evidence ?? "exact",
        provider: outbound.provider,
        requests: walk.meta?.requests ?? 0,
      },
      next: "Use lead_runway to see how many leads a campaign has left.",
      ok: true,
    };
  },
};
