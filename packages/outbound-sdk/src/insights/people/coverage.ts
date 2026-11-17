// What a safety check over campaigns covered, said first. A check that a cap
// stopped part way gives no total, because a bare 0 from part of the data is
// the answer a manager would forward as "none found".

import { plural } from "../../internal/numbers.ts";

/** One part of the data a cap left unread, and the input that raises it. */
export interface Gap {
  /** What was read and what was left, for example `20 campaigns, with more unread`. */
  readonly read: string;
  /** The input that raises the cap, or `null` when a request cap stopped the read. */
  readonly input: string | null;
}

/** What a check over campaigns read of them and of their leads. */
export interface CampaignsChecked {
  readonly campaigns: number;
  readonly moreCampaignsExist: boolean;
  /** `true` when a request cap, not `max_campaigns`, stopped the campaign listing. */
  readonly campaignsCut: boolean;
  readonly campaignsWithMoreLeads: number;
  /** Campaigns whose leads a request cap, not `max_leads_per_campaign`, stopped. */
  readonly leadsCut: number;
  readonly maxLeads: number;
}

/** The gaps in the campaigns and their leads. */
export const campaignGaps = (read: CampaignsChecked): Gap[] => {
  const leadsCapped = read.campaignsWithMoreLeads - read.leadsCut;

  return [
    ...(read.moreCampaignsExist
      ? [
          {
            input: read.campaignsCut ? null : "max_campaigns",
            read: `${plural(read.campaigns, "campaign")}, with more in those statuses unread`,
          },
        ]
      : []),
    ...(leadsCapped > 0
      ? [
          {
            input: "max_leads_per_campaign",
            read: `the first ${plural(read.maxLeads, "lead")} of ${plural(leadsCapped, "campaign that has", "campaigns that have")} more`,
          },
        ]
      : []),
    ...(read.leadsCut > 0
      ? [
          {
            input: null,
            read: `part of the leads of ${plural(read.leadsCut, "campaign")}`,
          },
        ]
      : []),
  ];
};

const joined = (parts: readonly string[]): string =>
  parts.length < 2
    ? (parts[0] ?? "")
    : `${parts.slice(0, -1).join(", ")} and ${parts.at(-1)}`;

/**
 * What a check left out, or `null` when it covered everything: "The check
 * is incomplete: it read only 20 campaigns, with more in those statuses
 * unread (max_campaigns). Raise max_campaigns to check the rest."
 */
export const gapsSentence = (gaps: readonly Gap[]): string | null => {
  if (gaps.length === 0) {
    return null;
  }

  const inputs = [
    ...new Set(gaps.flatMap((gap) => (gap.input === null ? [] : [gap.input]))),
  ];

  const raise = [
    ...(inputs.length > 0 ? [`raise ${joined(inputs)}`] : []),
    ...(gaps.some((gap) => gap.input === null)
      ? ["raise the request cap the notes name"]
      : []),
  ];

  return `The check is incomplete: it read only ${joined(gaps.map((gap) => `${gap.read} (${gap.input ?? "a request cap"})`))}. To check the rest, ${joined(raise)}.`;
};
