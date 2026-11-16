import { smartlead } from "../../src/smartlead/index.ts";
import type { AdapterSuite, RouteRequest } from "../helpers/adapter-suite.ts";
import type { RecordedRequest } from "../helpers/http.ts";

export const KEY = "sl_test_key_0123456789abcdef";
export const CAMPAIGN = "372";
export const LEAD = "789";
export const SENDER = "123";

/** The lead-in-campaign mapping id the inbox fixtures use as the thread id. */
export const THREAD = "2433664091";
export const API = "/api/v1";

// A request with an offset above 0 gets the last page.
const paged = (name: string) => (request: RouteRequest) => {
  const body = request.body as { offset?: number } | undefined;

  const offset = Number(
    request.url.searchParams.get("offset") ?? body?.offset ?? 0
  );

  return offset > 0 ? `${name}.page2.json` : `${name}.json`;
};

/** The address the lead-by-email fixture answers for. */
export const EMAIL = "person1@example.com";

// Any other address gets the documented empty object.
const byEmail = (request: RouteRequest) =>
  request.url.searchParams.get("email") === EMAIL
    ? "getLeadByEmail.json"
    : "getLeadByEmail.notfound.json";

/** The request as a URL, to read its path and query. */
export const urlOf = (request: RecordedRequest | undefined): URL =>
  new URL(request?.url ?? "");

export const suite: AdapterSuite = {
  ids: {
    campaign: CAMPAIGN,
    lead: LEAD,
    list: "500",
    sender: SENDER,
    thread: THREAD,
    webhook: "456",
  },
  // The key is the `api_key` query parameter and is sent nowhere else.
  isAuthorized: (request) =>
    urlOf(request).searchParams.get("api_key") === KEY &&
    request.headers.authorization === undefined,
  make: () => smartlead({ apiKey: KEY, workspaceId: "client-a" }),
  origin: "https://server.smartlead.ai",
  provider: "smartlead",
  // SmartDelivery serves the placement tests on its own host.
  sisterOrigins: ["https://smartdelivery.smartlead.ai"],
  routes: [
    {
      fixture: "listSpamTests.json",
      method: "POST",
      path: `${API}/spam-test/report`,
    },
    {
      fixture: "getLeadList.json",
      method: "GET",
      path: /^\/api\/v1\/lead-list\/\d+$/u,
    },
    {
      fixture: "getWebhook.json",
      method: "GET",
      path: /^\/api\/v1\/webhook\/\d+$/u,
    },
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
    { fixture: byEmail, method: "GET", path: `${API}/leads/` },
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
    {
      fixture: "analyticsDayWisePositiveReplyStats.json",
      method: "GET",
      path: `${API}/analytics/day-wise-positive-reply-stats`,
    },
    {
      fixture: "analyticsCampaignOverallStats.json",
      method: "GET",
      path: `${API}/analytics/campaign/overall-stats`,
    },
    { fixture: "listClients.json", method: "GET", path: `${API}/client/` },
    {
      fixture: "getEmailAccountWarmupStats.json",
      method: "GET",
      path: /^\/api\/v1\/email-accounts\/\d+\/warmup-stats$/u,
    },
    {
      fixture: "listEmailAccountTags.json",
      method: "GET",
      path: `${API}/email-accounts/tags`,
    },
    {
      fixture: paged("listLeadLists"),
      method: "GET",
      path: `${API}/lead-list/`,
    },
    {
      fixture: paged("listDomainBlockList"),
      method: "GET",
      path: `${API}/leads/get-domain-block-list`,
    },
    {
      fixture: "listLeadTags.json",
      method: "GET",
      path: `${API}/crm/leads/tags`,
    },
    {
      fixture: "listCampaignWebhooks.json",
      method: "GET",
      path: /^\/api\/v1\/campaigns\/\d+\/webhooks$/u,
    },
    {
      fixture: "getInboxItem.json",
      method: "GET",
      path: /^\/api\/v1\/master-inbox\/\d+$/u,
    },
    {
      fixture: "analyticsMailboxNameWiseHealth.json",
      method: "GET",
      path: `${API}/analytics/mailbox/name-wise-health-metrics`,
    },
  ],
  secret: KEY,
  // Leads: both fixture campaigns answer with the same three leads, and a
  // walk returns each lead once. Senders: the first page is shorter than the
  // page size the suite asks for, so the walk ends there; the adapter tests
  // walk both pages with a page size of 2. Lists and the block list end the
  // same way. Webhooks: both fixture campaigns answer with the same two, and
  // each is returned once. Subsequences have their own tests, because the
  // shared campaign list holds no child campaign.
  unsampled: {
    campaignSettings: {
      dailyLimit:
        "sending_limit is in the newer example only (getCampaign.newdocs.json)",
      startDate: "no documented campaign shows schedule_start_time",
      stopOnAutoReply:
        "out_of_office_detection_settings is documented on the settings update only",
    },
    message: {
      senderRef:
        "only a thread names its mailbox by id, and the documented thread has no email_account",
    },
    reply: {
      bodyHtml: "the documented replies are plain text",
      leadRef:
        "the documented threads name the lead by address; listInboxReplies.history.json adds an id",
    },
    senderHealth: {
      issues: "the documented mailbox has no failure and no blocked warmup",
    },
    sequence: {
      name: "only a subsequence has a name; listCampaigns.subsequences.json has them",
    },
    webhook: {
      active: "is_active is in the newer example only",
    },
  },
  totals: {
    blocklist: 2,
    campaigns: 2,
    leads: 3,
    lists: 2,
    messages: 6,
    replies: 3,
    senders: 2,
    tags: 3,
    webhooks: 2,
  },
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
