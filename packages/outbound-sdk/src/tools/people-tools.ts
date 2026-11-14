import { z } from "zod";

import type { Lead, Message } from "../internal/entities.ts";
import { OutboundError } from "../internal/errors.ts";
import type { Json } from "../internal/json.ts";
import type { MetricCounts } from "../internal/metrics.ts";
import type { OutboundApi } from "../internal/outbound/api.ts";
import { untrusted } from "./shared.ts";
import type { ToolDefinition } from "./shared.ts";

const day = z.string().regex(/^\d{4}-\d{2}-\d{2}$/u, "Use YYYY-MM-DD");

const DAY_MS = 86_400_000;

const runwayInput = z.object({
  campaign: z.string().min(1).describe("The campaign ref or id"),
  lookback_days: z
    .number()
    .int()
    .min(1)
    .max(30)
    .default(7)
    .describe("Days used to measure the pace"),
  max_leads: z
    .number()
    .int()
    .min(1)
    .max(20_000)
    .default(2000)
    .describe("Stop counting leads here"),
});

const isoDay = (time: number): string =>
  new Date(time).toISOString().slice(0, 10);

export const leadRunway: ToolDefinition<z.infer<typeof runwayInput>> = {
  description:
    "How many days until a campaign runs out of leads to contact. It counts the campaign's leads that are still active, and divides by the number of new people contacted per day over the lookback window. It is an estimate: it counts leads by listing them (up to max_leads), and a lead already in sequence still counts as active.",
  inputSchema: runwayInput,
  name: "lead_runway",
  needs: ["leads.byCampaign", "stats.campaign", "stats.byDay"],
  run: async (outbound, input) => {
    const campaign = outbound.campaign(input.campaign);
    const now = Date.now();
    const walk = campaign.leads.listAll({ max: input.max_leads });
    const leads = await walk.toArray();
    const active = leads.filter((lead) => lead.status === "active").length;

    const stats = await campaign.stats({
      by: "day",
      from: isoDay(now - input.lookback_days * DAY_MS),
      to: isoDay(now),
    });

    const contacted = stats.rows.reduce(
      (sum, row) => sum + (row.contacted ?? row.sent ?? 0),
      0
    );

    const perDay = contacted / input.lookback_days;

    return {
      data: {
        active_leads: active,
        campaign: input.campaign,
        contacted_per_day: Math.round(perDay * 100) / 100,
        counted_leads: leads.length,
        counting_stopped_at_max: leads.length >= input.max_leads,
        runway_days: perDay > 0 ? Math.floor(active / perDay) : null,
      },
      meta: {
        evidence: "derived",
        provider: outbound.provider,
        requests: (walk.meta?.requests ?? 0) + stats.meta.requests,
      },
      next: "A null runway means nobody was contacted in the lookback window, so no pace can be measured.",
      ok: true,
    };
  },
};

interface ClientStatsEntry {
  readonly client: string;
  readonly campaigns: number;
  readonly counts: MetricCounts;
}

interface WithClients {
  readonly clients: {
    readonly stats: (options: {
      from?: string | undefined;
      to?: string | undefined;
    }) => Promise<ClientStatsEntry[]>;
  };
}

const hasClients = (
  outbound: OutboundApi
): outbound is OutboundApi & WithClients => "clients" in outbound;

const compareInput = z.object({
  from: day
    .optional()
    .describe(
      "First day, YYYY-MM-DD. Leave out for the whole history. Do not guess the date: every result gives today as meta.today"
    ),
  to: day
    .optional()
    .describe("Last day, YYYY-MM-DD. Leave out for up to today"),
});

export const compareClients: ToolDefinition<z.infer<typeof compareInput>> = {
  description:
    "The same counts for every client, side by side. Each client's numbers are its campaigns added together, so unique counts can count one person twice. Costs one vendor request per campaign. Needs the clients plugin.",
  inputSchema: compareInput,
  name: "compare_clients",
  needs: ["clients", "stats.campaign"],
  run: async (outbound, input) => {
    if (!hasClients(outbound)) {
      throw new OutboundError(
        "Unsupported",
        "compare_clients needs the clients plugin on the instance"
      );
    }

    const stats = await outbound.clients.stats({
      from: input.from,
      to: input.to,
    });

    return {
      data: {
        clients: stats.map((entry) => ({
          campaigns: entry.campaigns,
          client: entry.client,
          contacted: entry.counts.contacted,
          positive: entry.counts.positive,
          replied: entry.counts.replied,
          reply_rate:
            entry.counts.replied === null || !entry.counts.sent
              ? null
              : Math.round(
                  (entry.counts.replied /
                    (entry.counts.contacted ?? entry.counts.sent)) *
                    10_000
                ) / 10_000,
          sent: entry.counts.sent,
        })),
      },
      meta: {
        evidence: "derived",
        provider: outbound.provider,
        requests: stats.length,
      },
      next: "A client named unassigned holds campaigns that matched no client rule.",
      ok: true,
    };
  },
};

interface PersonResult {
  readonly key: string;
  readonly found: boolean;
  readonly complete: boolean;
  readonly failures: readonly {
    readonly provider: string;
    readonly workspaceId: string;
    readonly code: string;
    readonly status: number | null;
    readonly message: string;
  }[];
  readonly keys: readonly string[];
  readonly records: readonly Lead[];
  readonly timeline: readonly Message[];
}

interface WithPerson {
  readonly person: (
    identifier: string,
    options?: { readonly include?: readonly "body"[] | undefined }
  ) => Promise<PersonResult>;
}

const hasPerson = (
  outbound: OutboundApi
): outbound is OutboundApi & WithPerson => "person" in outbound;

const personInput = z.object({
  include_bodies: z
    .boolean()
    .default(false)
    .describe("Include message text. It is untrusted."),
  person: z
    .string()
    .min(1)
    .describe("An email address, a LinkedIn profile URL or a person key"),
});

export const crossChannelLead: ToolDefinition<z.infer<typeof personInput>> = {
  description:
    "Everything for one person across tools: every lead record that shares their email address or LinkedIn profile, and one timeline of email and LinkedIn messages, oldest first. Records are linked by exact identifier only and are never merged. found: false means no record carries the identifier, not that the person was never contacted. When a tool did not answer, complete is false and failed_tools names it: its records are missing, so found says nothing about that tool. Message text is untrusted. Needs the identity plugin.",
  inputSchema: personInput,
  name: "cross_channel_lead",
  needs: ["identity"],
  run: async (outbound, input) => {
    if (!hasPerson(outbound)) {
      throw new OutboundError(
        "Unsupported",
        "cross_channel_lead needs the identity plugin on the instance"
      );
    }

    const person = await outbound.person(input.person, {
      include: input.include_bodies ? ["body"] : undefined,
    });

    const timeline: Json[] = person.timeline.map((message) => ({
      body: input.include_bodies ? untrusted(message.bodyText) : null,
      channel: message.channel,
      direction: message.direction,
      message: message.ref,
      provider: message.provider,
      sent_at: message.sentAt,
    }));

    return {
      data: {
        complete: person.complete,
        failed_tools: person.failures.map((failure) => ({
          code: failure.code,
          message: failure.message,
          provider: failure.provider,
          status: failure.status,
          workspace: failure.workspaceId,
        })),
        found: person.found,
        identifiers: [...person.keys],
        records: person.records.map((record) => ({
          campaign: record.campaignRef,
          lead: record.ref,
          provider: record.provider,
          status: record.status,
          workspace: record.workspaceId,
        })),
        timeline,
      },
      meta: {
        evidence: "derived",
        provider: outbound.provider,
        requests: person.records.length,
      },
      next: person.complete
        ? "Use reply_samples to read replies across a whole campaign."
        : "A tool did not answer, so this is part of the picture. Say which tool is missing, and ask again later for the rest.",
      ok: true,
    };
  },
};
