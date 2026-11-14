import { instantly } from "../../src/instantly/index.ts";
import type { AdapterSuite, RouteRequest } from "../helpers/adapter-suite.ts";

export const KEY = "inst_test_key_0123456789abcdef";
export const CAMPAIGN = "01a1d77f-5e23-7a9a-9112-a6f7089f329f";
export const LEAD = "01a1d77f-5156-7723-b616-dca4fb991449";

// A request that carries a cursor gets the last page.
const paged = (name: string) => (request: RouteRequest) => {
  const body = request.body as { starting_after?: string } | undefined;

  const cursor =
    request.url.searchParams.get("starting_after") ?? body?.starting_after;

  return cursor ? `${name}.page2.json` : `${name}.json`;
};

export const suite: AdapterSuite = {
  ids: { campaign: CAMPAIGN, lead: LEAD, sender: "person1@example.com" },
  isAuthorized: (request) => request.headers.authorization === `Bearer ${KEY}`,
  make: () => instantly({ apiKey: KEY, workspaceId: "client-a" }),
  origin: "https://api.instantly.ai",
  provider: "instantly",
  routes: [
    {
      fixture: paged("listCampaigns"),
      method: "GET",
      path: "/api/v2/campaigns",
    },
    {
      fixture: "getCampaignAnalyticsOverview.json",
      method: "GET",
      path: "/api/v2/campaigns/analytics/overview",
    },
    {
      fixture: "getCampaignAnalyticsDaily.json",
      method: "GET",
      path: "/api/v2/campaigns/analytics/daily",
    },
    {
      fixture: "getCampaignAnalyticsSteps.json",
      method: "GET",
      path: "/api/v2/campaigns/analytics/steps",
    },
    {
      fixture: "getCampaign.json",
      method: "GET",
      path: /^\/api\/v2\/campaigns\/[\w-]+$/u,
    },
    { fixture: paged("listAccounts"), method: "GET", path: "/api/v2/accounts" },
    {
      fixture: "getAccountDailyAnalytics.json",
      method: "GET",
      path: "/api/v2/accounts/analytics/daily",
    },
    {
      fixture: "getAccount.json",
      method: "GET",
      path: /^\/api\/v2\/accounts\/[^/]+$/u,
    },
    { fixture: paged("listLeads"), method: "POST", path: "/api/v2/leads/list" },
    {
      fixture: "getLead.json",
      method: "GET",
      path: /^\/api\/v2\/leads\/[\w-]+$/u,
    },
    {
      fixture: (request) =>
        paged(
          request.url.searchParams.get("email_type") === "received"
            ? "listReplies"
            : "listEmails"
        )(request),
      method: "GET",
      path: "/api/v2/emails",
    },
    {
      fixture: "getCurrentWorkspace.json",
      method: "GET",
      path: "/api/v2/workspaces/current",
    },
  ],
  secret: KEY,
  totals: { campaigns: 3, leads: 3, messages: 3, replies: 3, senders: 3 },
  webhooks: {
    "webhook.account_error.json": "sender.status_changed",
    "webhook.campaign_completed.json": "campaign.status_changed",
    "webhook.email_bounced.json": "message.bounced",
    "webhook.email_link_clicked.json": "message.clicked",
    "webhook.email_opened.json": "message.opened",
    "webhook.email_sent.json": "message.sent",
    "webhook.lead_closed.json": "reply.categorized",
    "webhook.lead_interested.json": "reply.categorized",
    "webhook.lead_meeting_booked.json": "meeting.booked",
    "webhook.lead_meeting_completed.json": "lead.status_changed",
    "webhook.lead_neutral.json": "reply.categorized",
    "webhook.lead_not_interested.json": "reply.categorized",
    "webhook.lead_out_of_office.json": "reply.categorized",
    "webhook.lead_unsubscribed.json": "lead.unsubscribed",
    "webhook.lead_wrong_person.json": "reply.categorized",
    "webhook.reply_received.json": "reply.received",
  },
};
