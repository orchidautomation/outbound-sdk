import { emailbison } from "../../src/emailbison/index.ts";
import type { AdapterSuite, RouteRequest } from "../helpers/adapter-suite.ts";

export const KEY = "9|eb_test_key_0123456789abcdef";
export const ORIGIN = "https://dedi.emailbison.com";
export const CAMPAIGN = "1";
export const SENDER = "1";
export const LEAD = "101";
export const LIST = "1";
export const THREAD = "45";

// A list read by cursor answers its last page once a cursor is sent.
const byCursor = (name: string) => (request: RouteRequest) =>
  request.url.searchParams.has("cursor")
    ? `${name}.page2.json`
    : `${name}.json`;

// A list read by number answers its last page from page 2 on.
const byNumber = (name: string) => (request: RouteRequest) =>
  Number(request.url.searchParams.get("page") ?? "1") > 1
    ? `${name}.page2.json`
    : `${name}.json`;

export const suite: AdapterSuite = {
  ids: {
    campaign: CAMPAIGN,
    lead: LEAD,
    list: LIST,
    sender: SENDER,
    thread: THREAD,
    webhook: "1",
  },
  isAuthorized: (request) => request.headers.authorization === `Bearer ${KEY}`,
  make: () => emailbison({ apiKey: KEY, workspaceId: "client-a" }),
  origin: ORIGIN,
  provider: "emailbison",
  routes: [
    {
      fixture: byCursor("listCampaigns"),
      method: "GET",
      path: "/api/campaigns",
    },
    { fixture: "getCampaign.json", method: "GET", path: "/api/campaigns/1" },
    {
      fixture: "getCampaignSchedule.json",
      method: "GET",
      path: "/api/campaigns/1/schedule",
    },
    {
      fixture: "getSequenceSteps.json",
      method: "GET",
      path: "/api/campaigns/v1.1/1/sequence-steps",
    },
    {
      fixture: byCursor("listCampaignLeads"),
      method: "GET",
      path: "/api/campaigns/1/leads",
    },
    {
      fixture: "listCampaignSenders.json",
      method: "GET",
      path: "/api/campaigns/1/sender-emails",
    },
    {
      fixture: "getCampaignStats.json",
      method: "POST",
      path: "/api/campaigns/1/stats",
    },
    {
      fixture: "getCampaignDailyStats.json",
      method: "GET",
      path: "/api/campaigns/1/line-area-chart-stats",
    },
    {
      fixture: "getCampaignEventStats.json",
      method: "GET",
      path: "/api/campaign-events/stats",
    },
    {
      fixture: byCursor("listSenders"),
      method: "GET",
      path: "/api/sender-emails",
    },
    { fixture: "getSender.json", method: "GET", path: "/api/sender-emails/1" },
    {
      fixture: "listSenderCampaigns.json",
      method: "GET",
      path: "/api/sender-emails/1/campaigns",
    },
    {
      fixture: "getSenderWarmup.json",
      method: "GET",
      path: "/api/warmup/sender-emails/1",
    },
    { fixture: byCursor("listLeads"), method: "GET", path: "/api/leads" },
    { fixture: "getLead.json", method: "GET", path: "/api/leads/101" },
    {
      fixture: "getLead.json",
      method: "GET",
      path: "/api/leads/person1%40example.com",
    },
    {
      fixture: "listLeadSentEmails.json",
      method: "GET",
      path: "/api/leads/101/sent-emails",
    },
    {
      fixture: "listLeadReplies.json",
      method: "GET",
      path: "/api/leads/101/replies",
    },
    {
      fixture: byCursor("listScheduledEmails"),
      method: "GET",
      path: "/api/scheduled-emails",
    },
    { fixture: byCursor("listReplies"), method: "GET", path: "/api/replies" },
    {
      fixture: "getConversationThread.json",
      method: "GET",
      path: "/api/replies/45/conversation-thread",
    },
    {
      fixture: "getWorkspaceStats.json",
      method: "GET",
      path: "/api/workspaces/v1.1/stats",
    },
    {
      fixture: "getWorkspaceDailyStats.json",
      method: "GET",
      path: "/api/workspaces/v1.1/line-area-chart-stats",
    },
    {
      fixture: "listWorkspaces.json",
      method: "GET",
      path: "/api/workspaces/v1.1",
    },
    {
      fixture: byNumber("listLeadLists"),
      method: "GET",
      path: "/api/lead-lists",
    },
    { fixture: "getLeadList.json", method: "GET", path: "/api/lead-lists/1" },
    {
      fixture: byCursor("listBlacklistedEmails"),
      method: "GET",
      path: "/api/blacklisted-emails",
    },
    {
      fixture: "listBlacklistedDomains.json",
      method: "GET",
      path: "/api/blacklisted-domains",
    },
    { fixture: "listTags.json", method: "GET", path: "/api/tags" },
    {
      fixture: byNumber("listWebhooks"),
      method: "GET",
      path: "/api/webhook-url",
    },
    { fixture: "getWebhook.json", method: "GET", path: "/api/webhook-url/1" },
  ],
  secret: KEY,
  totals: {
    blocklist: 5,
    campaigns: 3,
    leads: 3,
    lists: 3,
    messages: 3,
    replies: 3,
    senders: 3,
    tags: 3,
    webhooks: 3,
  },
  webhooks: {
    "webhook.EMAIL_SENT.json": "message.sent",
    "webhook.MANUAL_EMAIL_SENT.json": "message.sent",
    "webhook.LEAD_REPLIED.json": "reply.received",
    "webhook.LEAD_INTERESTED.json": "reply.categorized",
    "webhook.UNTRACKED_REPLY_RECEIVED.json": "reply.received",
    "webhook.EMAIL_BOUNCED.json": "message.bounced",
    "webhook.EMAIL_ACCOUNT_DISCONNECTED.json": "sender.status_changed",
    "webhook.TAG_ATTACHED.json": "unknown",
  },
};
