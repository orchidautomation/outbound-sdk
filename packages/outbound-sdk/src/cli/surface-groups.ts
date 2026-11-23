// The tools `outbound mcp` lists: neighbouring tools and insights merged into
// one tool each, picked by `view` (one answer) or `checks` (several
// answers in one call) (OUT-168). The names they merged stopped answering
// in 0.19.0.

export interface Member {
  /** The value of `view` or one of `checks`. */
  readonly key: string;
  /** The tool or insight it runs. */
  readonly tool: string;
}

export interface Group {
  readonly name: string;
  readonly description: string;
  /** `view` runs one member; `checks` runs every member named, in one answer. */
  readonly by: "checks" | "view";
  readonly members: readonly Member[];
  /** The view, or the checks, run when the input names none. */
  readonly default: readonly string[];
}

export const GROUPS: readonly Group[] = [
  {
    by: "view",
    default: ["list"],
    description:
      "Campaign results. view list: sends, replies, positive replies, bounces and reply rate per campaign (or one campaign) over a date range. view ranking: campaigns ranked fairly by the low end of the 95% interval of a rate, so a small campaign cannot outrank a big one. view trend: one count day by day for one campaign. A null count is one the vendor does not report, never 0. Campaigns running out of leads: client_report. For exports of every row use the CLI's --jsonl or the SDK.",
    members: [
      { key: "list", tool: "campaign_overview" },
      { key: "ranking", tool: "campaign_ranking" },
      { key: "trend", tool: "campaign_trend" },
    ],
    name: "campaigns",
  },
  {
    by: "checks",
    default: ["status"],
    description:
      "Sender health, one answer per check named. status: each sender's state, daily limit and warmup, failing ones first with what they break. deliverability: DNS records, sign-in, block lists and warmup spam per sender. warmup: which senders are not ready to send and why. domains: risk per sending domain. bounces: campaigns, and their senders, whose bounce rate is over a threshold. Each check costs its own requests, so name only the ones the question needs.",
    members: [
      { key: "status", tool: "sender_health" },
      { key: "deliverability", tool: "deliverability_check" },
      { key: "warmup", tool: "warmup_readiness" },
      { key: "domains", tool: "domain_health" },
      { key: "bounces", tool: "bounce_watch" },
    ],
    name: "sender_health",
  },
  {
    by: "view",
    default: ["capacity"],
    description:
      "Whether senders can carry the campaigns. view capacity: total daily capacity of active senders against the daily ask of active campaigns, recent sends, utilization, and campaigns whose own senders cannot cover their limit. view load: senders on too many campaigns, active senders on none, and campaigns on one sender, none, or an inactive one.",
    members: [
      { key: "capacity", tool: "sender_capacity" },
      { key: "load", tool: "sender_load" },
    ],
    name: "sender_capacity",
  },
  {
    by: "view",
    default: ["runway"],
    description:
      "How long one campaign's leads last; to find which campaigns run out, client_report lists every one in one call. view runway: days until no new lead is left to start, from the leads not yet started and the pace of new leads started per day (never emails sent). view forecast: the same runway with leads by status and the replies and positive replies to expect from the leads left, each with a 95% range. Both read the same runway computation.",
    members: [
      { key: "runway", tool: "lead_runway" },
      { key: "forecast", tool: "pipeline_forecast" },
    ],
    name: "lead_runway",
  },
  {
    by: "checks",
    default: ["suppression", "collisions"],
    description:
      "List hygiene across campaigns, one answer per check. suppression: leads still being sent to although they are on the block list, matched by email, domain or LinkedIn profile. collisions: people active in two or more campaigns at once, matched by email or LinkedIn profile. Each check says how many campaigns and leads it read, so a capped read never reads as no problem.",
    members: [
      { key: "suppression", tool: "suppression_check" },
      { key: "collisions", tool: "lead_collisions" },
    ],
    name: "list_hygiene",
  },
  {
    by: "checks",
    default: ["audit", "variants", "personalization"],
    description:
      "Review a campaign's copy, one answer per check. audit: problems in every step and variant (length, links, spam words, broken variables, capitals). variants: whether each step's A/B winner is real. personalization: leads who get broken copy because a merge variable is empty. reuse: how the same copy performs across campaigns (workspace-wide, no campaign needed). copy_preview renders a step as a lead receives it.",
    members: [
      { key: "audit", tool: "copy_audit" },
      { key: "variants", tool: "variant_test" },
      { key: "personalization", tool: "personalization_gaps" },
      { key: "reuse", tool: "copy_reuse" },
    ],
    name: "copy_review",
  },
  {
    by: "view",
    default: ["funnel"],
    description:
      "Where one campaign's replies come from. view funnel: one row per sequence step with sends, replies, reply rate with a 95% interval, share of replies and drop-off, and the last step that still earns its place. view winners: each step and variant ranked by reply rate. stepNumber counts from 1, as a person counts.",
    members: [
      { key: "funnel", tool: "step_funnel" },
      { key: "winners", tool: "winning_steps" },
    ],
    name: "step_funnel",
  },
  {
    by: "view",
    default: ["summary"],
    description:
      "One person or company across campaigns and channels. view summary: each campaign they are in, messages sent, replies, steps replied to and interest label, from a lead ref, email, LinkedIn URL or person. view timeline: every record sharing their email or LinkedIn profile and one message timeline. view account: everyone at a company, from a domain. Records link by exact identifier only. Under redact a view that needs identifiers answers with the masked summary.",
    members: [
      { key: "summary", tool: "person_summary" },
      { key: "timeline", tool: "cross_channel_lead" },
      { key: "account", tool: "account_summary" },
    ],
    name: "person",
  },
];

/** A tool that only changed its name. */
export const RENAMED = {
  dropped_replies: "unanswered_replies",
} as const satisfies Readonly<Record<string, string>>;
