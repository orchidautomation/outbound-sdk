// sender_load: senders that are overused or unused.

import { z } from "zod";

import type { Campaign, Sender } from "../../internal/entities.ts";
import { defineInsight } from "../define.ts";
import {
  readCampaigns,
  readCampaignSenders,
  readCapped,
  statusesInput,
} from "./read.ts";

const input = z.object({
  max_campaigns: z
    .number()
    .int()
    .min(1)
    .max(200)
    .default(25)
    .describe("The most campaigns to read. Each costs 1 request."),
  max_campaigns_per_sender: z
    .number()
    .int()
    .min(1)
    .default(3)
    .describe("A sender attached to more campaigns than this is overused"),
  max_senders: z
    .number()
    .int()
    .min(1)
    .max(1000)
    .default(200)
    .describe(
      "The most senders to read for the workspace, and for each campaign"
    ),
  statuses: statusesInput,
});

export interface LoadedSender {
  readonly sender: string;
  readonly address: string | null;
  readonly name: string | null;
  readonly status: string;
  readonly dailyLimit: number | null;
}

export interface OverusedSender extends LoadedSender {
  /** How many of the campaigns read the sender is attached to. */
  readonly campaigns: number;
  readonly over: number;
  readonly campaignRefs: readonly string[];
  readonly finding: string;
}

export type CampaignSenderIssue =
  | "inactive_sender"
  | "no_sender"
  | "single_sender";

export interface CampaignSenderRisk {
  readonly campaign: string;
  readonly name: string;
  readonly senders: number;
  readonly issues: readonly CampaignSenderIssue[];
  /** The campaign's senders whose status is not active. */
  readonly inactive: readonly LoadedSender[];
  readonly finding: string;
}

export interface SenderLoad {
  /** Senders in more campaigns than allowed, the most loaded first. */
  readonly overused: readonly OverusedSender[];
  /** Active senders attached to none of the campaigns read. */
  readonly unused: readonly LoadedSender[];
  /** Campaigns with no sender, one sender, or a sender that is not active. */
  readonly campaigns: readonly CampaignSenderRisk[];
  readonly totals: {
    readonly senders: number;
    readonly activeSenders: number;
    readonly campaigns: number;
    readonly overused: number;
    readonly unused: number;
    readonly campaignsAtRisk: number;
  };
  readonly maxCampaignsPerSender: number;
}

const loaded = (sender: Sender): LoadedSender => ({
  address: sender.address,
  dailyLimit: sender.dailyLimit,
  name: sender.name,
  sender: sender.ref,
  status: sender.status,
});

const riskOf = (
  campaign: Campaign,
  senders: readonly Sender[]
): CampaignSenderRisk | null => {
  const inactive = senders.filter((sender) => sender.status !== "active");

  const issues: CampaignSenderIssue[] = [
    ...(senders.length === 0 ? ["no_sender" as const] : []),
    ...(senders.length === 1 ? ["single_sender" as const] : []),
    ...(inactive.length > 0 ? ["inactive_sender" as const] : []),
  ];

  if (issues.length === 0) {
    return null;
  }

  const count = senders.length === 1 ? "1 sender" : `${senders.length} senders`;

  return {
    campaign: campaign.ref,
    finding:
      inactive.length > 0
        ? `${campaign.name} has ${count}, ${inactive.length} of them not active.`
        : `${campaign.name} has ${count}.`,
    inactive: inactive.map(loaded),
    issues,
    name: campaign.name,
    senders: senders.length,
  };
};

export const senderLoad = defineInsight({
  description:
    "Senders that are overused or unused: the senders attached to more campaigns than allowed, the active senders attached to no campaign, and the campaigns that run on a single sender, on none, or on a sender that is not active. Use it when sends are uneven or before adding a campaign. Costs one listing of senders and of campaigns, then 1 request per campaign. Only campaigns in the given statuses are counted, so a sender used only by a paused campaign shows as unused unless paused is included.",
  inputSchema: input,
  key: "senderLoad",
  name: "sender_load",
  needs: ["senders.list", "senders.byCampaign"],
  next: "Use sender_capacity to see whether the senders can cover the campaigns' daily limits, or warmup_readiness for the senders that are not active.",
  run: async (context, options) => {
    const { outbound } = context;
    const allowed = options.max_campaigns_per_sender;

    const senders = await readCapped(
      context,
      (cap) => outbound.senders.listAll({ max: cap }),
      options.max_senders,
      "senders"
    );

    const campaigns = await readCampaigns(
      context,
      options.statuses,
      options.max_campaigns
    );

    const known = new Map(senders.map((sender) => [sender.ref, sender]));
    const attached = new Map<string, string[]>();
    const risks: CampaignSenderRisk[] = [];

    for (const campaign of campaigns) {
      // oxlint-disable-next-line no-await-in-loop -- one campaign at a time keeps the rate budget predictable.
      const own = await readCampaignSenders(
        context,
        campaign,
        options.max_senders
      );

      const risk = riskOf(campaign, own);

      if (risk !== null) {
        risks.push(risk);
      }

      for (const sender of own) {
        known.set(sender.ref, sender);
        attached.set(sender.ref, [
          ...(attached.get(sender.ref) ?? []),
          campaign.ref,
        ]);
      }
    }

    const overused = [...attached]
      .flatMap(([ref, refs]): OverusedSender[] => {
        const sender = known.get(ref);

        return sender === undefined || refs.length <= allowed
          ? []
          : [
              {
                ...loaded(sender),
                campaignRefs: refs,
                campaigns: refs.length,
                finding: `${sender.address ?? sender.name ?? ref} is attached to ${refs.length} campaigns, ${refs.length - allowed} over the limit of ${allowed}.`,
                over: refs.length - allowed,
              },
            ];
      })
      .toSorted((left, right) => right.campaigns - left.campaigns);

    const active = senders.filter((sender) => sender.status === "active");
    const unused = active.filter((sender) => !attached.has(sender.ref));

    const answer: SenderLoad = {
      campaigns: risks.toSorted(
        (left, right) => right.issues.length - left.issues.length
      ),
      maxCampaignsPerSender: allowed,
      overused,
      totals: {
        activeSenders: active.length,
        campaigns: campaigns.length,
        campaignsAtRisk: risks.length,
        overused: overused.length,
        senders: senders.length,
        unused: unused.length,
      },
      unused: unused.map(loaded),
    };

    return answer;
  },
});
