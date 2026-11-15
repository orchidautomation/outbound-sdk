import { test } from "node:test";

import { cardFor } from "../../src/cards/index.ts";
import type {
  Anomalies,
  BounceWatch,
  CampaignDiagnosis,
  CampaignLabel,
  CampaignRanking,
  ChannelMix,
  ClientReport,
  Comparison,
  DomainHealth,
  DomainReport,
  Measured,
  PeriodComparison,
  PeriodNumbers,
  PipelineForecast,
  SenderCapacity,
  SenderLoad,
  SettingsAudit,
  TagRollup,
  WarmupReadiness,
} from "../../src/insights/index.ts";
import { excludes, includes, insight, read } from "./helpers.ts";

const NOTHING = "⚪ Nothing had enough data to check.";

const label = (name: string): CampaignLabel => ({
  campaign: `instantly:acme:${name}`,
  channel: "email",
  name,
  provider: "instantly",
  status: "active",
});

const rate = (count: number | null, of: number | null): Measured => ({
  count,
  high: count === null ? null : 0.08,
  low: count === null ? null : 0.04,
  of,
  rate: count === null || of === null ? null : count / of,
});

const bounce = (over: number, clean: number): BounceWatch => ({
  minSent: 100,
  over: Array.from({ length: over }, () => ({
    bounced: 40,
    campaign: "c1",
    finding: "Founders Q4 bounces at 8.0%, above the 3.0% limit.",
    interval: { high: 0.1, low: 0.06 },
    name: "Founders Q4",
    rate: 0.08,
    senders: null,
    sent: 500,
    status: "active",
  })),
  sendersRead: 2,
  threshold: 0.03,
  tooFewSends: [],
  totals: {
    bounced: 40,
    campaigns: over + clean,
    clean,
    over,
    rate: 0.05,
    sent: 800,
    tooFewSends: 0,
    unknown: 0,
  },
  unknown: [],
});

test("bounce_watch flags campaigns over the limit", () => {
  includes(
    read(cardFor("bounce_watch", insight(bounce(1, 2)))),
    "🔴 Above the 3.0% bounce limit: 1 campaign.",
    "Founders Q4 | 500  | 40      | 8.0% (6.0–10.0%)",
    "Overall bounce rate: 5.0%"
  );
  includes(
    read(cardFor("bounce_watch", insight(bounce(0, 2)))),
    "🟢 No campaign is above the 3.0% bounce limit."
  );
  includes(read(cardFor("bounce_watch", insight(bounce(0, 0)))), NOTHING);
});

const domain = (name: string, risk: DomainReport["risk"]): DomainReport => ({
  blacklisted: 0,
  disconnected: 0,
  domain: name,
  failingDns: risk === "high" ? ["dkim", "dmarc"] : [],
  mailboxes: [
    {
      address: `a@${name}`,
      blacklisted: null,
      connected: true,
      failingDns: [],
      issues: [],
      sender: "s1",
      status: "active",
    },
  ],
  notReported: [],
  reasons: risk === "low" ? ["nothing wrong"] : ["DKIM and DMARC fail"],
  risk,
  warmup: {
    interval: null,
    mailboxes: 1,
    sent: 100,
    spam: 12,
    spamRate: risk === "high" ? 0.12 : null,
  },
});

const domains = (reports: DomainReport[]): DomainHealth => ({
  domains: reports,
  linkedinSeats: [],
  mailboxesWithoutDomain: [],
  totals: {
    domains: reports.length,
    high: reports.filter((report) => report.risk === "high").length,
    linkedinSeats: 0,
    low: reports.filter((report) => report.risk === "low").length,
    medium: 0,
    senders: reports.length,
    unknown: 0,
  },
});

test("domain_health puts the riskiest domain first", () => {
  const text = read(
    cardFor(
      "domain_health",
      insight(
        domains([domain("good.example", "low"), domain("bad.example", "high")])
      )
    )
  );

  includes(
    text,
    "🔴 1 sending domain at high risk.",
    "• 🔴 **bad.example**: DKIM and DMARC fail",
    "bad.example  | 🔴 high | 1         | DKIM DMARC  | 12.0%",
    "good.example | 🟢 low  | 1         | —           | —"
  );
  excludes(text, "nothing wrong");
  includes(
    read(
      cardFor(
        "domain_health",
        insight(domains([domain("good.example", "low")]))
      )
    ),
    "🟢 No sending domain is at high risk."
  );
  includes(read(cardFor("domain_health", insight(domains([])))), NOTHING);
});

test("domain_health says a domain with no DNS checks reported is of unknown risk, and lists what is not reported", () => {
  const silent: DomainReport = {
    ...domain("quiet.example", "unknown"),
    notReported: ["spf", "dkim", "dmarc", "mx", "blocklist"],
    reasons: [],
  };

  const report = domains([silent]);

  const text = read(
    cardFor(
      "domain_health",
      insight({ ...report, totals: { ...report.totals, unknown: 1 } })
    )
  );

  includes(
    text,
    "⚪ 1 sending domain of unknown risk: the vendor reports none of SPF, DKIM, DMARC and MX for it.",
    "spf, dkim, dmarc, mx, blocklist"
  );
  excludes(text, "🟢");
});

test("sender_capacity repeats the finding and lists short campaigns", () => {
  const capacity: SenderCapacity = {
    ask: { campaigns: 3, daily: 500, withLimit: 3, withoutLimit: 0 },
    askRatio: 1.25,
    capacity: {
      activeSenders: 10,
      daily: 400,
      inactiveSenders: 2,
      linkedinDaily: null,
      mailboxDaily: 400,
      withLimit: 10,
      withoutLimit: 0,
    },
    finding: "Campaigns ask for 500 sends a day but senders can do 400.",
    sends: {
      averageDaily: 310.5,
      days: 7,
      daysWithData: 7,
      from: "2026-11-07",
      fromUncounted: 93,
      scope: "workspace",
      to: "2026-11-13",
      total: 2173,
    },
    shortCampaigns: [
      {
        activeSenders: 1,
        campaign: "c1",
        dailyLimit: 200,
        finding: "Founders Q4 asks for 200 a day from senders that can do 80.",
        name: "Founders Q4",
        senderCapacity: 80,
        senders: 2,
        shortBy: 120,
      },
    ],
    uncheckedCampaigns: 0,
    utilization: 0.776,
  };

  includes(
    read(cardFor("sender_capacity", insight(capacity))),
    "Campaigns ask for 500 sends a day but senders can do 400.",
    "Daily capacity: 400",
    "Campaigns ask for: 500",
    "Average sent per day: 310.5",
    "Capacity in use: 77.6%",
    "Sent by senders not counted: 93",
    "• 🟡 Founders Q4 asks for 200 a day from senders that can do 80."
  );
});

const sender = (address: string | null, name: string | null) => ({
  address,
  dailyLimit: 40,
  name,
  sender: "instantly:acme:s9",
  status: "active",
});

const load = (problems: boolean, senders: number): SenderLoad => ({
  campaigns: problems
    ? [
        {
          campaign: "c1",
          finding: "Founders Q4 has one sender.",
          inactive: [],
          issues: ["single_sender"],
          name: "Founders Q4",
          senders: 1,
        },
      ]
    : [],
  maxCampaignsPerSender: 3,
  overused: problems
    ? [
        {
          ...sender("a@example.com", null),
          campaignRefs: [],
          campaigns: 5,
          finding: "a@example.com sends for 5 campaigns.",
          over: 2,
        },
      ]
    : [],
  totals: {
    activeSenders: senders,
    campaigns: 4,
    campaignsAtRisk: problems ? 1 : 0,
    overused: problems ? 1 : 0,
    senders,
    unused: problems ? 3 : 0,
  },
  unused: problems
    ? [
        sender("b@example.com", null),
        sender(null, "Seat One"),
        sender(null, null),
      ]
    : [],
});

test("sender_load lists overused senders, thin campaigns and idle senders", () => {
  includes(
    read(cardFor("sender_load", insight(load(true, 12)))),
    "1 sender overused, 1 campaign at risk.",
    "• 🔴 a@example.com sends for 5 campaigns.",
    "• 🟡 Founders Q4 has one sender.",
    "• ⚪ Not used by any campaign: b@example.com, Seat One, instantly:acme:s9"
  );
  includes(
    read(cardFor("sender_load", insight(load(false, 12)))),
    "🟢 No sender is overused and no campaign is short of senders."
  );
  includes(read(cardFor("sender_load", insight(load(false, 0)))), NOTHING);
});

const settings = (campaigns: number, flagged: boolean): SettingsAudit => ({
  // The card reads only the totals from the per-check counts.
  byCheck: {} as SettingsAudit["byCheck"],
  campaigns: flagged
    ? [
        {
          campaign: "c1",
          findings: [
            {
              check: "reply_does_not_stop",
              finding: "A reply does not stop the sequence.",
              severity: "high",
              value: null,
            },
          ],
          name: "Founders Q4",
          status: "active",
        },
      ]
    : [],
  totals: {
    campaigns,
    clean: flagged ? campaigns - 1 : campaigns,
    high: flagged ? 1 : 0,
    low: 0,
    medium: 0,
    withFindings: flagged ? 1 : 0,
  },
});

test("settings_audit names the campaign beside each finding", () => {
  includes(
    read(cardFor("settings_audit", insight(settings(4, true)))),
    "1 campaign with a setting to look at.",
    "• 🔴 **Founders Q4**: A reply does not stop the sequence.",
    "High: 1"
  );
  includes(
    read(cardFor("settings_audit", insight(settings(4, false)))),
    "🟢 No campaign setting looks wrong."
  );
  includes(
    read(cardFor("settings_audit", insight(settings(0, false)))),
    NOTHING
  );
});

const readiness = (
  notReady: number,
  total: number,
  healthChecked = false
): WarmupReadiness => ({
  // Reasons with no sender are left out of the card.
  byReason: { low_score: notReady, warmup_off: 0 } as never,
  healthChecked,
  linkedinSeats: 0,
  notReady: Array.from({ length: notReady }, () => ({
    address: "new@example.com",
    dailyLimit: 20,
    findings: [],
    kind: "mailbox" as const,
    name: null,
    reasons: ["low_score"] as never,
    score: 61,
    sender: "s1",
    status: "active",
    warmupEnabled: true,
  })),
  ready: total - notReady,
  total,
});

test("warmup_readiness says how many senders are ready and why not", () => {
  const text = read(cardFor("warmup_readiness", insight(readiness(1, 5))));

  includes(
    text,
    "🟡 4 of 5 senders are ready on warmup alone; DNS and warmup spam were not checked.",
    "Low score: 1",
    "new@example.com | active | 61           | low score"
  );
  excludes(text, "Warmup off", "ready to send");

  const unchecked = read(cardFor("warmup_readiness", insight(readiness(0, 5))));

  includes(
    unchecked,
    "🟢 Every sender is ready on warmup alone (5 checked); DNS and warmup spam were not checked."
  );
  excludes(unchecked, "ready to send");
  includes(
    read(cardFor("warmup_readiness", insight(readiness(1, 5, true)))),
    "🟡 4 of 5 senders are ready to send."
  );
  includes(
    read(cardFor("warmup_readiness", insight(readiness(0, 5, true)))),
    "🟢 Every sender is ready to send (5 checked)."
  );
  includes(
    read(cardFor("warmup_readiness", insight(readiness(0, 0)))),
    NOTHING
  );
});

const scan = (found: boolean, testable: boolean): Anomalies => ({
  anomalies: found
    ? [
        {
          baselineMean: 4,
          baselinePoints: 14,
          date: "2026-11-12",
          direction: "above",
          judgedBy: "z_score",
          finding: "Bounced was 31 on 2026-11-12, against a usual 4.",
          metric: "bounced",
          value: 31,
          zScore: 4.2,
        },
        {
          baselineMean: 300,
          baselinePoints: 14,
          date: "2026-11-13",
          direction: "below",
          judgedBy: "z_score",
          finding: "Sent was 20 on 2026-11-13, against a usual 300.",
          metric: "sent",
          value: 20,
          zScore: -3.4,
        },
      ]
    : [],
  metrics: [
    {
      daysTested: testable ? 16 : 0,
      daysWithData: testable ? 30 : 0,
      metric: "bounced",
      reason: testable ? null : "The vendor reports no bounced count.",
      testable,
    },
  ],
  period: { from: "2026-10-15", to: "2026-11-13" },
  scope: "workspace",
  threshold: 3,
});

test("anomalies points up or down for each day that stands out", () => {
  includes(
    read(cardFor("anomalies", insight(scan(true, true)))),
    "workspace · 2026-10-15 to 2026-11-13",
    "🟡 Days that stand out from the baseline: 2.",
    "• 🔺 Bounced was 31 on 2026-11-12, against a usual 4.",
    "• 🔻 Sent was 20 on 2026-11-13, against a usual 300."
  );
  includes(
    read(cardFor("anomalies", insight(scan(false, true)))),
    "🟢 No day stands out from its own baseline."
  );
  includes(
    read(cardFor("anomalies", insight(scan(false, false)))),
    NOTHING,
    "Note: Bounced: The vendor reports no bounced count."
  );
});

test("campaign_diagnosis gives each finding with what to do next", () => {
  const diagnosis: CampaignDiagnosis = {
    ...label("Founders Q4"),
    findings: [
      {
        code: "high_bounce" as never,
        finding: "Bounce rate is 8.0%.",
        next: "Run deliverability_check.",
        numbers: { bounced: 40 },
        severity: "high",
      },
    ],
    notChecked: ["sender health"],
    period: { from: null, to: null },
    rates: {
      bounceRate: rate(40, 500),
      positiveRate: rate(null, null),
      replyRate: rate(30, 500),
    },
    summary: "One thing is wrong: bounces.",
    totals: {
      bounced: 40,
      contacted: 480,
      positive: null,
      replied: 30,
      sent: 500,
    },
  };

  includes(
    read(cardFor("campaign_diagnosis", insight(diagnosis))),
    "Founders Q4 · active · email",
    "One thing is wrong: bounces.",
    "Sent: 500",
    "Positive: —",
    "Reply rate: 6.0% (4.0–8.0%)",
    "Positive rate: —",
    "• 🔴 Bounce rate is 8.0%. Next: Run deliverability_check.",
    "Note: Not checked: sender health"
  );
});

const ranking = (names: string[], thin: number): CampaignRanking => ({
  better: "higher",
  campaignsRead: names.length + thin,
  gap: { difference: 0.02, median: 0.04, top: 0.06 },
  metric: "reply_rate" as never,
  moreCampaignsExist: false,
  period: { from: null, to: null },
  ranked: names.map((name, index) => ({
    ...label(name),
    ...rate(30 - index * 10, 500),
    rank: index + 1,
    sent: 500,
  })),
  tooFewSends: Array.from({ length: thin }, () => ({
    ...label("Thin"),
    reason: "under 100 sends",
    sent: 20,
  })),
  unknown: [],
});

test("campaign_ranking ranks by the measured rate with its interval", () => {
  includes(
    read(
      cardFor("campaign_ranking", insight(ranking(["Founders", "Agencies"], 1)))
    ),
    "Reply rate, higher is better",
    "Founders ranks first at 6.0%.",
    "1 | Founders | 500  | 6.0% (4.0–8.0%)",
    "2 | Agencies | 500  | 4.0% (4.0–8.0%)",
    "Gap: 2.0%",
    "Founders | 6",
    "1 campaign left out: too few sends to rank."
  );
  includes(
    read(cardFor("campaign_ranking", insight(ranking([], 0)))),
    "No campaign has enough sends to rank."
  );
});

const channelGroup = (channel: "email" | "linkedin", replied: number) => ({
  acceptance: null,
  bounced: null,
  campaigns: 2,
  channel,
  contacted: 500,
  positive: 5,
  positiveRate: rate(5, 500),
  replied,
  replyRate: rate(replied, 500),
  sent: 500,
});

test("channel_mix compares email and LinkedIn", () => {
  const mix: ChannelMix = {
    byProvider: [],
    campaignsRead: 2,
    channels: [channelGroup("email", 20), channelGroup("linkedin", 45)],
    comparison: null,
    finding: "LinkedIn replies at 9.0% against 4.0% for email.",
    moreCampaignsExist: false,
    period: { from: null, to: null },
  };

  includes(
    read(cardFor("channel_mix", insight(mix))),
    "LinkedIn replies at 9.0% against 4.0% for email.",
    "Email    | 2         | 500  | 20      | 4.0% (4.0–8.0%)",
    "Linkedin | 2         | 500  | 45      | 9.0% (4.0–8.0%)",
    "Replies by channel"
  );
});

const numbers = (
  sent: number | null,
  replied: number | null
): PeriodNumbers => ({
  bounceRate: null,
  bounced: null,
  contacted: sent,
  positive: null,
  positiveRate: null,
  replied,
  replyRate: sent === null || replied === null ? null : replied / sent,
  sent,
});

const comparison = (verdict: Comparison["verdict"]): Comparison => ({
  change: numbers(200, -10),
  current: numbers(1200, 50),
  finding: "Reply rate fell from 6.0% to 4.2%, more than chance.",
  previous: numbers(1000, 60),
  replyRateTest: null,
  verdict,
});

test("period_comparison shows each number now and before", () => {
  const periods: PeriodComparison = {
    campaignsRead: 2,
    campaigns: [
      { ...label("Founders"), ...comparison("down") },
      { ...label("Agencies"), ...comparison("up") },
      { ...label("Steady"), ...comparison("no_real_change") },
      { ...label("Blank"), ...comparison("unknown") },
    ],
    current: { from: "2026-11-07", to: "2026-11-13" },
    days: 7,
    moreCampaignsExist: false,
    previous: { from: "2026-10-31", to: "2026-11-06" },
    tooFewSends: [],
    total: comparison("down"),
    workspace: null,
  };

  includes(
    read(cardFor("period_comparison", insight(periods))),
    "Last 7 days against the 7 before",
    "2026-11-07 to 2026-11-13, against 2026-10-31 to 2026-11-06",
    "Reply rate fell from 6.0% to 4.2%, more than chance.",
    "Sent: 1,200 (was 1,000)",
    "Reply rate: 4.2% (was 6.0%)",
    "Positive: —",
    "Founders | 4.2%           | 6.0%   | 🔻 down",
    "Agencies | 4.2%           | 6.0%   | 🔺 up",
    "Steady   | 4.2%           | 6.0%   | ▪️ no real change",
    "Blank    | 4.2%           | 6.0%   | ⚪ unknown"
  );
});

const forecast = (daysLeft: number | null): PipelineForecast => ({
  ...label("Founders Q4"),
  assumptions: ["The reply rate stays where it is."],
  // The card does not show the split by lead status.
  byStatus: {} as PipelineForecast["byStatus"],
  dailyContactRate: 35,
  daysLeft,
  estimate: true,
  expectedPositive: { expected: null, high: null, low: null },
  expectedReplies: { expected: 25.2, high: 34, low: 17 },
  finding: "About 25 more replies from the 420 leads left.",
  leadsComplete: true,
  leadsRead: 900,
  positiveRate: rate(null, null),
  remaining: 420,
  replyRate: rate(30, 500),
});

test("pipeline_forecast is labelled as an estimate", () => {
  includes(
    read(cardFor("pipeline_forecast", insight(forecast(12)))),
    "About 25 more replies from the 420 leads left.",
    "Leads left to contact: 420",
    "Days of leads left: 12 days",
    "Expected replies: 25 (17–34)",
    "Expected positive: —",
    "Note: An estimate, not a count.",
    "Note: The reply rate stays where it is."
  );
  includes(
    read(cardFor("pipeline_forecast", insight(forecast(null)))),
    "Days of leads left: —"
  );
});

const tagGroup = (tag: string | null, replied: number) => ({
  bounceRate: rate(null, null),
  bounced: null,
  campaigns: 2,
  contacted: 500,
  positive: null,
  positiveRate: rate(null, null),
  replied,
  replyRate: rate(replied, 500),
  sent: 500,
  tag,
});

test("tag_rollup groups results by tag, naming the untagged group", () => {
  const rollup: TagRollup = {
    campaigns: 4,
    campaignsRead: 4,
    moreCampaignsExist: true,
    period: { from: null, to: null },
    tags: [tagGroup("client-a", 30), tagGroup(null, 20)],
    tooFewSends: [],
  };

  includes(
    read(cardFor("tag_rollup", insight(rollup))),
    "4 campaigns · 2 tags",
    "client-a | 2         | 500  | 30      | 6.0% (4.0–8.0%) | —",
    "(no tag) | 2         | 500  | 20      | 4.0% (4.0–8.0%) | —",
    "client-a | 6",
    "• 🟡 Stopped at 4 campaigns read (max_campaigns); more exist and are not in this answer."
  );
});

const report = (withActions: boolean): ClientReport => ({
  actions: withActions
    ? [
        {
          action: "Add leads to Founders Q4: 4 days left.",
          campaign: "c1",
          campaignName: "Founders Q4",
          kind: "add_leads",
          number: 4,
        },
      ]
    : [],
  anomalies: null,
  bottom: [],
  bounceProblems: [],
  campaigns: 3,
  campaignsRead: 3,
  days: 7,
  leftOut: ["anomalies: the vendor reports no daily counts"],
  moreCampaignsExist: false,
  period: { from: "2026-11-07", to: "2026-11-13" },
  previousPeriod: { from: "2026-10-31", to: "2026-11-06" },
  runningOutOfLeads: null,
  top: [{ ...label("Founders Q4"), ...rate(30, 500), rank: 1, sent: 500 }],
  totals: comparison("down"),
});

test("client_report leads with the change and lists what to do", () => {
  const text = read(cardFor("client_report", insight(report(true))));

  includes(
    text,
    "3 campaigns · 2026-11-07 to 2026-11-13",
    "Reply rate fell from 6.0% to 4.2%, more than chance.",
    "Replies: 50 (was 60)",
    "• 👉 Add leads to Founders Q4: 4 days left.",
    "1 | Founders Q4   | 500  | 6.0% (4.0–8.0%)",
    "Note: Left out: anomalies: the vendor reports no daily counts"
  );
  excludes(read(cardFor("client_report", insight(report(false)))), "👉", "🟢");
});
