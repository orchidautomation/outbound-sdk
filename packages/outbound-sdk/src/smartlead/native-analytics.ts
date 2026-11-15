// Smartlead's account-wide analytics that have no normalized form. Every
// number here is the vendor's own; see "How Analytics Metrics Are Calculated"
// in the reference for which counts may be added up across days.

import { defineNative, inQuery, inQueryRequired } from "../internal/native.ts";
import { DOMAIN_HEALTH_LANE } from "./capabilities.ts";
import { DOCS } from "./native-params.ts";

const CLIENTS = {
  client_ids: inQuery("string", "Only these clients: ids separated by commas."),
};

const SCOPE = {
  ...CLIENTS,
  campaign_ids: inQuery(
    "string",
    "Only these campaigns: ids separated by commas."
  ),
};

/** Both days are included. The analytics spell the zone `timezone`. */
const WINDOW = {
  end_date: inQueryRequired("string", "Last day, YYYY-MM-DD."),
  start_date: inQueryRequired("string", "First day, YYYY-MM-DD."),
  timezone: inQuery("string", "IANA time zone, for example America/New_York."),
};

/** The by-sent-time reads require the zone. */
const ZONED_WINDOW = {
  ...WINDOW,
  timezone: inQueryRequired(
    "string",
    "IANA time zone, for example America/New_York."
  ),
};

const FULL = {
  full_data: inQuery("string", 'Set to "true" for the full data set.'),
};

/** The analytics take paging numbers as strings. */
const PAGE = {
  limit: inQuery("string", "Most rows to return."),
  offset: inQuery("string", "Rows to skip."),
};

export const ANALYTICS = defineNative({
  analyticsCampaignFollowUpReplyRate: {
    description: "The reply rate of follow-up steps (second email onwards).",
    docs: `${DOCS}/analytics/followup-reply-rate`,
    method: "GET",
    params: { ...WINDOW, ...SCOPE },
    path: "/analytics/campaign/follow-up-reply-rate",
  },
  analyticsCampaignLeadToReplyTime: {
    description: "The average time from a lead's first email to its reply.",
    docs: `${DOCS}/analytics/lead-to-reply-time`,
    method: "GET",
    params: { ...WINDOW, ...SCOPE },
    path: "/analytics/campaign/lead-to-reply-time",
  },
  analyticsCampaignLeadsForFirstReply: {
    description: "How many leads are contacted, on average, per first reply.",
    docs: `${DOCS}/analytics/leads-for-first-reply`,
    method: "GET",
    params: { ...WINDOW, ...SCOPE },
    path: "/analytics/campaign/leads-take-for-first-reply",
  },
  analyticsCampaignList: {
    description: "The id and name of every campaign, for analytics filters.",
    docs: `${DOCS}/analytics/campaign-list`,
    method: "GET",
    params: CLIENTS,
    path: "/analytics/campaign/list",
  },
  analyticsCampaignPerformance: {
    description:
      "One row per campaign in a date window: counts, rates and lead totals.",
    docs: `${DOCS}/analytics/campaign-performance`,
    method: "GET",
    params: { ...WINDOW, ...SCOPE, ...PAGE, ...FULL },
    path: "/analytics/campaign/overall-stats",
  },
  analyticsCampaignResponseStats: {
    description:
      "Replies per campaign in a date window, split by reply sentiment.",
    docs: `${DOCS}/analytics/campaign-response-stats`,
    method: "GET",
    params: { ...WINDOW, ...SCOPE, ...FULL },
    path: "/analytics/campaign/response-stats",
  },
  analyticsCampaignStatusStats: {
    description: "How many campaigns are in each status.",
    docs: `${DOCS}/analytics/campaign-status-stats`,
    method: "GET",
    params: CLIENTS,
    path: "/analytics/campaign/status-stats",
  },
  analyticsClientList: {
    description: "The id and name of every client, for analytics filters.",
    docs: `${DOCS}/analytics/client-list`,
    method: "GET",
    params: CLIENTS,
    path: "/analytics/client/list",
  },
  analyticsClientMonthlyCount: {
    description: "How many clients the account had, month by month.",
    docs: `${DOCS}/analytics/month-wise-client-count`,
    method: "GET",
    params: CLIENTS,
    path: "/analytics/client/month-wise-count",
  },
  analyticsClientPerformance: {
    description:
      "One row per client in a date window, with that client's campaign totals.",
    docs: `${DOCS}/analytics/client-performance`,
    method: "GET",
    params: {
      ...WINDOW,
      ...CLIENTS,
      ...PAGE,
      ...FULL,
      filter: inQuery("string", "Filter value for the client rows."),
    },
    path: "/analytics/client/overall-stats",
  },
  analyticsDailyBySentTime: {
    description:
      "Daily sent, opened, replied and bounced counts, each counted on the day its email was sent. The only daily read that reports bounces.",
    docs: `${DOCS}/analytics/day-wise-sent-time`,
    method: "GET",
    params: { ...ZONED_WINDOW, ...SCOPE },
    path: "/analytics/day-wise-overall-stats-by-sent-time",
  },
  analyticsDailyPositiveReplies: {
    description: "Positive replies per day, counted on the day of the reply.",
    docs: `${DOCS}/analytics/day-wise-positive-reply`,
    method: "GET",
    params: { ...WINDOW, ...SCOPE },
    path: "/analytics/day-wise-positive-reply-stats",
  },
  analyticsDailyPositiveRepliesBySentTime: {
    description:
      "Positive replies per day, counted on the day the replied-to email was sent.",
    docs: `${DOCS}/analytics/day-wise-positive-sent-time`,
    method: "GET",
    params: { ...ZONED_WINDOW, ...SCOPE },
    path: "/analytics/day-wise-positive-reply-stats-by-sent-time",
  },
  analyticsLeadCategoryResponses: {
    description:
      "Replies in a date window by lead category, with each one's share.",
    docs: `${DOCS}/analytics/lead-category-response`,
    method: "GET",
    params: { ...WINDOW, ...SCOPE },
    path: "/analytics/lead/category-wise-response",
  },
  analyticsLeadStats: {
    description:
      "Leads reached in a date window: the total, new leads and follow-ups.",
    docs: `${DOCS}/analytics/lead-stats`,
    method: "GET",
    params: { ...WINDOW, ...SCOPE },
    path: "/analytics/lead/overall-stats",
  },
  analyticsMailboxDomainHealth: {
    description:
      "Sent, opened, replied and bounced counts per sending domain in a date window.",
    docs: `${DOCS}/analytics/domain-wise-health`,
    lane: DOMAIN_HEALTH_LANE,
    method: "GET",
    params: { ...WINDOW, ...SCOPE, ...PAGE, ...FULL },
    path: "/analytics/mailbox/domain-wise-health-metrics",
  },
  analyticsMailboxOverall: {
    description:
      "How many mailboxes are connected, in use, disconnected, or enabled without warmup.",
    docs: `${DOCS}/analytics/mailbox-health`,
    method: "GET",
    params: CLIENTS,
    path: "/analytics/mailbox/overall-stats",
  },
  analyticsMailboxProviderPerformance: {
    description:
      "Counts and rates in a date window per mailbox provider (Gmail, Outlook, SMTP).",
    docs: `${DOCS}/analytics/provider-performance`,
    method: "GET",
    params: { ...WINDOW, ...SCOPE, ...FULL },
    path: "/analytics/mailbox/provider-wise-overall-performance",
  },
  analyticsTeamBoard: {
    description: "Results in a date window per team member.",
    docs: `${DOCS}/analytics/team-board-stats`,
    method: "GET",
    params: { ...WINDOW, ...SCOPE, ...FULL },
    path: "/analytics/team-board/overall-stats",
  },
});
