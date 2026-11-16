import assert from "node:assert/strict";
import { test } from "node:test";

import { cardFor } from "../../src/cards/index.ts";
import type {
  AccountSummary,
  CopyAudit,
  CopyReuse,
  DroppedReplies,
  HotLeads,
  LeadCollisions,
  PersonalizationGaps,
  PersonSummary,
  ReplyTiming,
  StepFunnel,
  SuppressionCheck,
  VariantTest,
} from "../../src/insights/index.ts";
import { excludes, includes, insight, read } from "./helpers.ts";

const NOTHING = "⚪ Nothing had enough data to check.";

const person = (found: boolean): PersonSummary => ({
  campaigns: [
    {
      autoReplied: false,
      campaign: "instantly:acme:c1",
      campaignName: "Founders Q4",
      campaignStatus: "active",
      channel: "email",
      firstContactedAt: "2026-11-01T09:00:00.000Z",
      interest: "Interested",
      lastContactedAt: "2026-11-06T09:00:00.000Z",
      lastRepliedAt: "2026-11-05T10:00:00.000Z",
      lastStep: 2,
      lastStepIndex: 2,
      lastStepNumber: 3,
      lead: "instantly:acme:l1",
      leadStatus: "replied",
      messagesSent: 3,
      provider: "instantly",
      replied: true,
      repliedStepIndexes: [1],
      repliedStepNumbers: [2],
      repliedSteps: [1],
      replies: 1,
    },
  ],
  found,
  identifiers: ["email:person1@example.com"],
  totals: {
    byChannel: { email: { messagesSent: 3, replies: 1 } },
    campaignReplyRate: 0.5,
    campaigns: 2,
    campaignsReplied: 1,
    messagesSent: 3,
    replies: 1,
  },
});

test("person_summary shows one person across campaigns and channels", () => {
  includes(
    read(cardFor("person_summary", insight(person(true)))),
    "person1@example.com",
    "Replied in 1 of 2 campaigns.",
    "Email: 3 sent · 1 reply",
    "Founders Q4 | email   | 3    | 1       | Interested | 2026-11-06"
  );
  includes(
    read(cardFor("person_summary", insight(person(false)))),
    "No record carries this identifier."
  );
});

const account = (lastReply: AccountSummary["lastReply"]): AccountSummary => ({
  domain: "example.com",
  finding: "1 person at example.com; 1 replied.",
  foundBy: "search",
  lastReply,
  people: [
    {
      campaigns: ["c1", "c2"],
      clicks: null,
      company: "Example Co",
      email: "person1@example.com",
      interested: true,
      lastRepliedAt: "2026-11-05T10:00:00.000Z",
      name: null,
      opens: 2,
      records: [],
      replied: true,
      replies: 1,
      title: "Founder",
    },
  ],
  totals: {
    campaigns: 2,
    interested: 1,
    leadsRead: 40,
    leadsWithoutEmail: 0,
    moreLeadsExist: false,
    people: 1,
    records: 2,
    replied: 1,
  },
});

test("account_summary names the last person to reply", () => {
  includes(
    read(
      cardFor(
        "account_summary",
        insight(
          account({
            at: "2026-11-05T10:00:00.000Z",
            campaign: "c1",
            email: "person1@example.com",
            lead: "l1",
            name: null,
          })
        )
      )
    ),
    "example.com",
    "Last reply: person1@example.com on 2026-11-05.",
    "person1@example.com | Founder | 2         | 1       | 2026-11-05"
  );
  includes(
    read(cardFor("account_summary", insight(account(null)))),
    "Nobody at this company has replied."
  );
});

test("account_summary with nobody found says whether the scan covered the workspace", () => {
  const finding =
    "Checked the first 1,000 leads and more exist; none matched. This does not mean nobody at example.com is in a campaign.";

  const empty: AccountSummary = {
    ...account(null),
    finding,
    foundBy: "scan",
    people: [],
    totals: { ...account(null).totals, moreLeadsExist: true, people: 0 },
  };

  const card = read(cardFor("account_summary", insight(empty)));
  includes(card, finding);
  excludes(card, "Nobody at this company has replied.");
});

const collisions = (found: number, leadsRead: number): LeadCollisions => ({
  collisions:
    found === 0
      ? []
      : [
          {
            campaignCount: 2,
            campaigns: [],
            channels: ["email"],
            finding: "person1@example.com is in 2 campaigns at once.",
            identifiers: ["email:person1@example.com"],
            providers: ["instantly"],
            scope: "within_tool",
            stillActive: 2,
          },
        ],
  totals: {
    acrossTools: 0,
    campaignsRead: 3,
    collisions: found,
    concurrent: found,
    leadsRead,
    leadsWithoutIdentifier: 0,
    pastOverlaps: 0,
    withinTool: found,
  },
});

test("lead_collisions counts people in two campaigns at once", () => {
  includes(
    read(cardFor("lead_collisions", insight(collisions(1, 80)))),
    "🟡 1 person in two or more campaigns at once.",
    "• 🟡 person1@example.com is in 2 campaigns at once.",
    "Within one tool: 1"
  );
  includes(
    read(cardFor("lead_collisions", insight(collisions(0, 80)))),
    "🟢 Nobody is in two campaigns at once."
  );
  includes(
    read(cardFor("lead_collisions", insight(collisions(0, 0)))),
    NOTHING
  );
});

test("lead_collisions does not say at once when only past overlaps were asked for", () => {
  const past: LeadCollisions = {
    collisions: [
      {
        campaignCount: 2,
        campaigns: [],
        channels: ["email"],
        finding:
          'person1@example.com was in "Founders" (completed) and is now active in "Agencies".',
        identifiers: ["email:person1@example.com"],
        providers: ["instantly"],
        scope: "within_tool",
        stillActive: 1,
      },
    ],
    totals: {
      acrossTools: 0,
      campaignsRead: 3,
      collisions: 1,
      concurrent: 0,
      leadsRead: 80,
      leadsWithoutIdentifier: 0,
      pastOverlaps: 1,
      withinTool: 1,
    },
  };

  const card = read(cardFor("lead_collisions", insight(past)));

  includes(
    card,
    "🟡 1 person in two or more campaigns, none active in two now."
  );
  excludes(card, "at once");
});

const check = (found: number): SuppressionCheck => ({
  byCampaign: [],
  totals: {
    alreadyStopped: 3,
    blockEntriesNotChecked: 0,
    blockEntriesRead: 12,
    byMatch: { domain: found, email: 0, linkedin: 0 },
    campaignsRead: 2,
    leadsRead: 300,
    moreBlockEntriesExist: false,
    moreLeadsExist: false,
    violations: found,
  },
  violations: Array.from({ length: found }, (_, index) => ({
    campaign: "c1",
    campaignName: "Founders Q4",
    entry: "blk_1",
    entryValue: "competitor.example",
    finding: `lead${index}@competitor.example is blocked by domain but is in Founders Q4.`,
    lead: `l${index}`,
    leadStatus: "active",
    email: `lead${index}@competitor.example`,
    linkedinUrl: null,
    matchedBy: "domain" as const,
    sameTool: true,
  })),
});

test("suppression_check lists blocked leads still in a campaign", () => {
  includes(
    read(cardFor("suppression_check", insight(check(2)))),
    "🔴 2 blocked leads still in a campaign.",
    "By domain: 2",
    "Already stopped, not counted: 3",
    "• 🔴 lead1@competitor.example is blocked by domain but is in Founders Q4."
  );
  includes(
    read(cardFor("suppression_check", insight(check(0)))),
    "🟢 No blocked lead is in a campaign."
  );
});

const dropped = (count: number, repliesRead: number): DroppedReplies => ({
  dropped: Array.from({ length: count }, (_, index) => ({
    campaign: "c1",
    campaignName: index === 0 ? "Founders Q4" : null,
    category: "interested",
    channel: "email" as const,
    checkedBy: "thread" as const,
    finding: "",
    email: index === 0 ? null : `person${index}@example.com`,
    hoursWaiting: 72 - index * 60,
    lead: `l${index}`,
    linkedinUrl: null,
    name: index === 0 ? "Jordan Example" : null,
    provider: "instantly",
    receivedAt: "2026-11-10T10:00:00.000Z",
    reply: `r${index}`,
    subject: null,
    unansweredReplies: 1,
  })),
  olderThanHours: 4,
  since: "2026-11-01T00:00:00.000Z",
  totals: {
    answered: 5,
    conversations: 5 + count,
    dropped: count,
    moreRepliesExist: false,
    repliesRead,
    skippedAuto: 0,
    skippedByCategory: 0,
    tooRecent: 1,
    unchecked: 0,
  },
});

test("dropped_replies leads with the longest wait", () => {
  includes(
    read(cardFor("dropped_replies", insight(dropped(2, 9)))),
    "🔴 2 replies waiting. The longest has waited 3d.",
    "Jordan Example      | Founders Q4 | Interested | 3d",
    "person1@example.com | c1          | Interested | 12h",
    "Answered: 5"
  );
  includes(
    read(cardFor("dropped_replies", insight(dropped(0, 9)))),
    "🟢 Every reply read has an answer."
  );
  includes(read(cardFor("dropped_replies", insight(dropped(0, 0)))), NOTHING);
});

const lead = (name: string | null, email: string | null, score: number) => ({
  campaign: "c1",
  clicks: null,
  company: "Example Co",
  email,
  interest: "Interested",
  lastRepliedAt: null,
  lead: "instantly:acme:l9",
  linkedinUrl: null,
  name,
  opens: 2,
  parts: { clicks: null, interest: 40, opens: 2, recency: 5, replies: 15 },
  reason: "marked Interested, replied 1 time(s).",
  replies: 1,
  score,
  status: "replied",
  title: null,
});

test("hot_leads ranks who to call, and falls back from name to email", () => {
  const hot: HotLeads = {
    leads: [
      lead("Alex Example", "alex@example.com", 62),
      lead(null, "sam@example.com", 40),
      lead(null, null, 20),
    ],
    totals: {
      autoReplied: 0,
      excluded: 0,
      fromReplies: 0,
      hot: 3,
      leadsRead: 50,
      moreLeadsExist: false,
      negative: 0,
      scored: 12,
      withoutData: 0,
    },
  };

  includes(
    read(cardFor("hot_leads", insight(hot))),
    "3 leads to call first.",
    "Alex Example      | Example Co | 62    | marked Interested, replied 1 time(s).",
    "sam@example.com   | Example Co | 40",
    "instantly:acme:l9 | Example Co | 20"
  );
  includes(
    read(
      cardFor("hot_leads", insight({ ...hot, leads: [] } satisfies HotLeads))
    ),
    "No lead scores as hot yet."
  );

  const capped = {
    ...hot,
    totals: { ...hot.totals, fromReplies: 2, moreLeadsExist: true },
  } satisfies HotLeads;

  includes(
    read(cardFor("hot_leads", insight(capped))),
    "🟡 Stopped at 50 leads read; more exist and were not scored, except 2 leads found through recent replies."
  );
});

const gaps = (affected: number): PersonalizationGaps => ({
  campaign: "c1",
  leads: [],
  totals: {
    affectedRate: affected / 200,
    leadsAffected: affected,
    leadsRead: 200,
    steps: 3,
    variables: 2,
  },
  unknownVariables: affected === 0 ? [] : ["compnay"],
  variables: [
    {
      gap: affected > 0,
      leadsAffected: affected,
      leadsWithoutValue: affected,
      name: "firstName",
      source: "builtin",
      steps: [0, 2],
      uses: [],
    },
    {
      gap: false,
      leadsAffected: 0,
      leadsWithoutValue: 0,
      name: "company",
      source: "builtin",
      steps: [],
      uses: [],
    },
  ],
});

test("personalization_gaps shows only the variables with a gap", () => {
  const text = read(cardFor("personalization_gaps", insight(gaps(30))));

  includes(
    text,
    "🔴 30 leads will get broken copy (15% of those read).",
    "• 🟡 `compnay` is not a field any lead has.",
    "firstName | builtin | 1, 3  | 30"
  );
  excludes(text, "company  ");
  includes(
    read(cardFor("personalization_gaps", insight(gaps(0)))),
    "🟢 Every lead read has a value for every variable."
  );
});

const step = (index: number, replies: number | null) => ({
  action: "email",
  delayDays: 3,
  earnsPlace: replies === null ? null : replies > 2,
  inSequence: true,
  rates: {
    replyRate: {
      basis: "sent" as const,
      count: replies,
      high: replies === null ? null : 0.08,
      low: replies === null ? null : 0.04,
      of: 400,
      rate: replies === null ? null : replies / 400,
    },
  },
  replies,
  replyRate: replies === null ? null : replies / 400,
  replyRateBasis: "sent" as const,
  replyRateInterval: replies === null ? null : { high: 0.08, low: 0.04 },
  sent: 400,
  sentDrop: null,
  sentDropRate: null,
  shareOfReplies: replies === null ? null : replies / 26,
  step: index,
  stepIndex: index,
  stepNumber: index + 1,
  variants: [],
});

test("step_funnel charts replies by step and repeats the insight's finding", () => {
  const funnel: StepFunnel = {
    campaign: "c1",
    finding: "Step 1 brings 92% of replies.",
    lastStepEarningPlace: 0,
    lastStepEarningPlaceIndex: 0,
    lastStepEarningPlaceNumber: 1,
    steps: [step(0, 24), step(1, 2), step(2, null)],
    topStep: 0,
    topStepIndex: 0,
    topStepNumber: 1,
    totals: { replies: 26, sent: 1200 },
    unattributed: { replies: null, rows: 1, sent: null },
  };

  includes(
    read(cardFor("step_funnel", insight(funnel))),
    "Step 1 brings 92% of replies.",
    "1    | 400  | 24      | 6% (4–8%)   | 92.3%            | Yes",
    "2    | 400  | 2       | 0.5% (4–8%) | 7.7%             | No",
    "3    | 400  | —       | —           | —                | —",
    "Replies by step",
    "Step 1 | 24",
    "1 stats row could not be tied to a step."
  );
});

const tested = (reported: boolean | null): VariantTest => ({
  alpha: 0.05,
  campaign: "c1",
  metric: "replied",
  steps: [
    {
      leader: "B",
      moreSendsNeeded: null,
      pValue: 0.01,
      reason: "B is ahead by more than chance.",
      step: 0,
      stepIndex: 0,
      stepNumber: 1,
      variants: ["A", "B"].map((variantKey, index) => ({
        basis: "sent" as const,
        count: 10 + index * 20,
        enoughData: true,
        high: 0.07,
        low: 0.01,
        of: 500,
        pValueVsLeader: null,
        rate: (10 + index * 20) / 500,
        sent: 500,
        variantKey,
      })),
      verdict: "winner",
    },
    {
      leader: null,
      moreSendsNeeded: 300,
      pValue: null,
      reason: "Too few sends to compare.",
      step: 1,
      stepIndex: 1,
      stepNumber: 2,
      variants: [],
      verdict: "too_little_data",
    },
  ],
  totals: {
    noDifferenceYet: 0,
    stepsTested: 2,
    tooLittleData: 1,
    winners: 1,
  },
  variantStatsReported: reported,
});

test("variant_test stars the leader and says why", () => {
  includes(
    read(cardFor("variant_test", insight(tested(true)))),
    "1 step with a real winner out of 2 tested.",
    "• 🟢 **Step 1**: B is ahead by more than chance.",
    "• ⚪ **Step 2**: Too few sends to compare.",
    "1    | A       | 500  | 2% (1–7%)",
    "1    | B ★     | 500  | 6% (1–7%)"
  );
  includes(
    read(cardFor("variant_test", insight(tested(false)))),
    "The vendor does not report results by variant for this campaign."
  );
  includes(
    read(cardFor("variant_test", insight(tested(null)))),
    "No step stats in this date range."
  );
});

const audit = (clean: boolean, variantsChecked: number): CopyAudit => ({
  byCheck: [],
  bySeverity: { high: clean ? 0 : 1, low: 0, medium: clean ? 0 : 1 },
  campaign: "c1",
  campaignName: "Founders Q4",
  channel: "email",
  clean,
  findings: clean
    ? []
    : [
        {
          action: "email",
          check: "spam_words",
          finding: "The body uses 2 spam words.",
          severity: "high",
          step: 0,
          stepIndex: 0,
          stepNumber: 1,
          text: "free",
          variantKey: "A",
        },
        {
          action: "email",
          check: "too_many_links",
          finding: "The body has 3 links.",
          severity: "medium",
          step: 1,
          stepIndex: 1,
          stepNumber: 2,
          text: "",
          variantKey: "A",
        },
      ],
  stepsChecked: 2,
  variantsChecked,
  variantsWithoutBody: 0,
});

test("copy_audit marks each finding by severity", () => {
  includes(
    read(cardFor("copy_audit", insight(audit(false, 2)))),
    "*Copy audit*\nFounders Q4",
    "2 problems found in the copy.",
    "• 🔴 Step 1 A: The body uses 2 spam words.",
    "• 🟡 Step 2 A: The body has 3 links.",
    "High: 1"
  );
  includes(
    read(cardFor("copy_audit", insight(audit(true, 2)))),
    "🟢 No problem found in the copy."
  );
  includes(read(cardFor("copy_audit", insight(audit(true, 0)))), NOTHING);

  // Copy written per lead that no lead's values could render is not called
  // clean, and not called a problem either.
  const unaudited = read(
    cardFor(
      "copy_audit",
      insight({ ...audit(true, 2), clean: false, variantsNotAudited: 2 })
    )
  );

  includes(
    unaudited,
    "⚪ Not audited: 2 variants written per lead could not be audited as any lead receives them."
  );
  assert.ok(!unaudited.includes("No problem found"));
  assert.ok(!unaudited.includes("problems found"));

  includes(
    read(
      cardFor(
        "copy_audit",
        insight({ ...audit(false, 2), variantsNotAudited: 1 })
      )
    ),
    "2 problems found in the copy. 1 variant written per lead could not be audited as any lead receives it."
  );
});

test("copy_reuse names the best copy and each reused piece", () => {
  const piece = {
    basis: "sent" as const,
    bodyPreview: "Saw you are hiring",
    campaigns: 2,
    contentHash: "abc",
    rates: {
      replyRate: {
        basis: "sent" as const,
        count: 30,
        high: 0.08,
        low: 0.04,
        of: 500,
        rate: 0.06,
      },
    },
    replies: 30,
    replyRate: 0.06,
    replyRateInterval: { high: 0.08, low: 0.04 },
    sent: 500,
    subject: "Quick question",
    trials: 500,
  };

  const reuse = (withBest: boolean): CopyReuse => ({
    basis: "sent",
    bestCopy: withBest ? piece : null,
    campaignsRead: 4,
    moreCampaignsExist: false,
    piecesOfCopy: 7,
    reused: [
      {
        ...piece,
        best: "c1",
        finding: "The same copy gets 8% in Founders and 4% in Agencies.",
        spread: 0.04,
        spreadIsReal: true,
        spreadPValue: 0.03,
        subject: null,
        uses: [],
        worst: "c2",
      },
    ],
    variantsWithoutStats: 0,
  });

  includes(
    read(cardFor("copy_reuse", insight(reuse(true)))),
    'Best copy: "Quick question" at 6% (4–8%).',
    "• The same copy gets 8% in Founders and 4% in Agencies.",
    "Saw you are hiring | 2         | 500  | 6%         | 4%"
  );
  includes(
    read(cardFor("copy_reuse", insight(reuse(false)))),
    "No copy has enough results to name a best one."
  );
});

const timing = (topWeekday: string | null): ReplyTiming => ({
  campaign: null,
  counts: {
    followOnReplies: 0,
    messagesRead: 90,
    paired: 20,
    received: 22,
    sent: 68,
    unpaired: 2,
    unpairedShare: 0.0909,
  },
  replies: {
    byHour: [],
    byWeekday: [
      { count: 12, share: 0.6, weekday: "Tuesday" },
      { count: 8, share: 0.4, weekday: "Wednesday" },
    ],
    topHour: topWeekday === null ? null : 10,
    topWeekday,
  },
  sendsThatDrewReplies: {
    byHour: [],
    byWeekday: [],
    topHour: null,
    topWeekday: null,
  },
  since: "2026-10-01T00:00:00.000Z",
  timeToReply: {
    medianHours: 5,
    p75Hours: 26,
    p90Hours: 80,
    sample: 20,
    within1Hour: 0.1,
    within24Hours: 0.7,
    within72Hours: 0.9,
  },
  timezoneOffsetMinutes: 0,
});

test("reply_timing says when replies arrive", () => {
  includes(
    read(cardFor("reply_timing", insight(timing("Tuesday")))),
    "Most replies arrive on Tuesday around 10:00.",
    "Median time to reply: 5h",
    "90% reply within: 3d",
    "Within 24 hours: 70%",
    "Tue | 12"
  );
  includes(
    read(cardFor("reply_timing", insight(timing(null)))),
    "No replies to time yet."
  );
});
