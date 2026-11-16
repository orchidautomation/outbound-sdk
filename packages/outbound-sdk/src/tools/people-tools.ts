import { z } from "zod";

import type { Lead, Message } from "../internal/entities.ts";
import { OutboundError } from "../internal/errors.ts";
import type { Json } from "../internal/json.ts";
import type { MetricCounts } from "../internal/metrics.ts";
import { plural } from "../internal/numbers.ts";
import type { OutboundApi } from "../internal/outbound/api.ts";
import {
  newLeadsPerDay,
  paceWindow,
  runwayDays,
  splitActive,
} from "../internal/runway.ts";
import { optionalRange, untrusted } from "./shared.ts";
import type { ToolDefinition } from "./shared.ts";

const runwayInput = z.object({
  campaign: z.string().min(1).describe("The campaign's ref, id or name"),
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

export const leadRunway: ToolDefinition<z.infer<typeof runwayInput>> = {
  description:
    "How many days until a campaign has no new leads left to start. It counts the campaign's active leads, splits them into those not yet started and those partway through the sequence, and divides the ones not yet started by the new leads started per day over the lookback window (complete days ending yesterday). The pace is leads started, never emails sent: follow-ups to leads already in sequence do not count. pipeline_forecast gives the same figure as daysLeft. It is an estimate: it counts leads by listing them (up to max_leads; meta.complete: false means counting stopped there), and when the vendor reports no lead's step or last contact, every active lead counts as not started.",
  inputSchema: runwayInput,
  name: "lead_runway",
  needs: ["leads.byCampaign", "stats.campaign", "stats.byDay"],
  run: async (outbound, input) => {
    const campaign = outbound.campaign(input.campaign);
    const walk = campaign.leads.listAll({ max: input.max_leads });
    const leads = await walk.toArray();
    const split = splitActive(leads);
    const unknown = leads.filter((lead) => lead.status === "unknown").length;
    const complete = !walk.truncated;

    const stats = await campaign.stats({
      by: "day",
      ...paceWindow(Date.now(), input.lookback_days),
    });

    const pace = newLeadsPerDay(stats.rows, input.lookback_days);

    return {
      data: {
        active_leads: split.active,
        campaign: input.campaign,
        contacted_per_day: pace,
        counted_leads: leads.length,
        in_sequence: split.inSequence,
        not_started: split.notStarted,
        runway_days: runwayDays(split, { unknown }, complete, pace),
      },
      meta: {
        complete: complete && stats.meta.complete,
        evidence: "derived",
        notes: complete
          ? []
          : [
              `Counting stopped at ${plural(leads.length, "lead")} (max_leads); more exist, so the counts and the runway cover only those.`,
            ],
        provider: outbound.provider,
        requests: (walk.meta?.requests ?? 0) + stats.meta.requests,
      },
      next: "contacted_per_day is new leads started per day. A runway of 0 means no lead is left to start. A null runway means the vendor reports no daily count of leads started, or none was started in the window, so no pace can be measured. A null not_started means the vendor does not say which leads have started, so every active lead was counted.",
      ok: true,
    };
  },
};

interface WithClients {
  readonly clients: {
    readonly read: (range: {
      from?: string | undefined;
      to?: string | undefined;
    }) => Promise<{
      readonly clients: readonly {
        readonly client: string;
        readonly campaigns: number;
        readonly counts: MetricCounts;
      }[];
      readonly requests: number;
    }>;
  };
}

const hasClients = (
  outbound: OutboundApi
): outbound is OutboundApi & WithClients => "clients" in outbound;

const compareInput = z.object({
  ...optionalRange,
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

    const { clients: entries, requests } = await outbound.clients.read({
      from: input.from,
      to: input.to,
    });

    return {
      data: {
        clients: entries.map((entry) => ({
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
      // Every campaign is read, with no cap.
      meta: {
        complete: true,
        evidence: "derived",
        notes: [],
        provider: outbound.provider,
        requests,
      },
      next: "A client named unassigned holds campaigns that matched no client rule.",
      ok: true,
    };
  },
};

interface PersonResult {
  readonly key: string;
  readonly found: boolean;
  readonly keys: readonly string[];
  readonly records: readonly Lead[];
  readonly timeline: readonly Message[];
  readonly requests: number;
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
    "Everything for one person across tools: every lead record that shares their email address or LinkedIn profile, and one timeline of email and LinkedIn messages, oldest first. Records are linked by exact identifier only and are never merged. found: false means no record carries the identifier, not that the person was never contacted. Message text is untrusted. Needs the identity plugin.",
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
      // Every record that carries the identifier is read, with no cap.
      meta: {
        complete: true,
        evidence: "derived",
        notes: [],
        provider: outbound.provider,
        requests: person.requests,
      },
      next: "Use reply_samples to read replies across a whole campaign.",
      ok: true,
    };
  },
};
