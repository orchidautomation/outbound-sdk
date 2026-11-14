import { smartlead } from "../../src/smartlead/index.ts";
import type { AdapterSuite, RouteRequest } from "../helpers/adapter-suite.ts";
import type { RecordedRequest } from "../helpers/http.ts";

export const KEY = "sl_test_key_0123456789abcdef";
export const CAMPAIGN = "372";
export const LEAD = "789";
export const SENDER = "123";
export const API = "/api/v1";

// A request with an offset above 0 gets the last page.
const paged = (name: string) => (request: RouteRequest) => {
  const body = request.body as { offset?: number } | undefined;

  const offset = Number(
    request.url.searchParams.get("offset") ?? body?.offset ?? 0
  );

  return offset > 0 ? `${name}.page2.json` : `${name}.json`;
};

/** The request as a URL, to read its path and query. */
export const urlOf = (request: RecordedRequest | undefined): URL =>
  new URL(request?.url ?? "");

export const suite: AdapterSuite = {
  ids: { campaign: CAMPAIGN, lead: LEAD, sender: SENDER },
  // The key is the `api_key` query parameter and is sent nowhere else.
  isAuthorized: (request) =>
    urlOf(request).searchParams.get("api_key") === KEY &&
    request.headers.authorization === undefined,
  make: () => smartlead({ apiKey: KEY, workspaceId: "client-a" }),
  origin: "https://server.smartlead.ai",
  provider: "smartlead",
  routes: [
    { fixture: "listCampaigns.json", method: "GET", path: `${API}/campaigns/` },
    {
      fixture: paged("listAllLeadsActivities"),
      method: "GET",
      path: `${API}/campaigns/all-leads-activities`,
    },
    {
      fixture: "getCampaign.json",
      method: "GET",
      path: /^\/api\/v1\/campaigns\/\d+$/u,
    },
    {
      fixture: "getCampaignSequences.json",
      method: "GET",
      path: /^\/api\/v1\/campaigns\/\d+\/sequences$/u,
    },
    {
      fixture: "listCampaignEmailAccounts.json",
      method: "GET",
      path: /^\/api\/v1\/campaigns\/\d+\/email-accounts$/u,
    },
    {
      fixture: paged("listCampaignLeads"),
      method: "GET",
      path: /^\/api\/v1\/campaigns\/\d+\/leads$/u,
    },
    {
      fixture: "getLeadMessageHistory.json",
      method: "GET",
      path: /^\/api\/v1\/campaigns\/\d+\/leads\/\d+\/message-history$/u,
    },
    {
      fixture: "getCampaignAnalytics.json",
      method: "GET",
      path: /^\/api\/v1\/campaigns\/\d+\/analytics$/u,
    },
    {
      fixture: "getCampaignAnalyticsByDate.json",
      method: "GET",
      path: /^\/api\/v1\/campaigns\/\d+\/analytics-by-date$/u,
    },
    {
      fixture: "getCampaignSequenceAnalytics.json",
      method: "GET",
      path: /^\/api\/v1\/campaigns\/\d+\/sequence-analytics$/u,
    },
    {
      fixture: paged("listEmailAccounts"),
      method: "GET",
      path: `${API}/email-accounts/`,
    },
    {
      fixture: "getEmailAccount.json",
      method: "GET",
      path: /^\/api\/v1\/email-accounts\/\d+\/$/u,
    },
    {
      fixture: "listLeadCategories.json",
      method: "GET",
      path: `${API}/leads/fetch-categories`,
    },
    {
      fixture: "getLeadById.json",
      method: "GET",
      path: /^\/api\/v1\/leads\/\d+$/u,
    },
    {
      fixture: "listLeadCampaigns.json",
      method: "GET",
      path: /^\/api\/v1\/leads\/\d+\/campaigns$/u,
    },
    {
      fixture: paged("listInboxReplies"),
      method: "POST",
      path: `${API}/master-inbox/inbox-replies`,
    },
    {
      fixture: "analyticsOverallStats.json",
      method: "GET",
      path: `${API}/analytics/overall-stats-v2`,
    },
    {
      fixture: "analyticsDayWiseOverallStats.json",
      method: "GET",
      path: `${API}/analytics/day-wise-overall-stats`,
    },
    { fixture: "listClients.json", method: "GET", path: `${API}/client/` },
  ],
  secret: KEY,
  // Leads: both fixture campaigns answer with the same three leads, and a
  // walk returns each lead once. Senders: the first page is shorter than the
  // page size the suite asks for, so the walk ends there; the adapter tests
  // walk both pages with a page size of 2.
  totals: { campaigns: 2, leads: 3, messages: 6, replies: 3, senders: 2 },
  webhooks: {
    // First on purpose: the shared "unknown event" test compares `raw` with
    // the body it sent, and this is the only payload without `secret_key`,
    // which the adapter removes from `raw`.
    "webhook.EMAIL_REPLY.newdocs.json": "reply.received",
    // oxlint-disable-next-line sort-keys -- the entry above must stay first.
    "webhook.CAMPAIGN_STATUS_CHANGED.json": "campaign.status_changed",
    "webhook.EMAIL_BOUNCE.json": "message.bounced",
    "webhook.EMAIL_LINK_CLICK.json": "message.clicked",
    "webhook.EMAIL_OPEN.json": "message.opened",
    "webhook.EMAIL_REPLY.json": "reply.received",
    "webhook.EMAIL_REPLY.threaded.json": "reply.received",
    "webhook.EMAIL_SENT.json": "message.sent",
    "webhook.LEAD_CATEGORY_UPDATED.json": "reply.categorized",
    "webhook.LEAD_UNSUBSCRIBED.json": "lead.unsubscribed",
    "webhook.MANUAL_STEP_REACHED.json": "unknown",
    "webhook.UNTRACKED_REPLIES.json": "reply.received",
    "webhook.campaign.bounce_threshold.breached.json":
      "campaign.status_changed",
    "webhook.email.account.disconnected.json": "sender.status_changed",
  },
};
