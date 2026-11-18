import { instantly } from "../../src/instantly/index.ts";
import type { AdapterSuite, RouteRequest } from "../helpers/adapter-suite.ts";

export const KEY = "inst_test_key_0123456789abcdef";
export const CAMPAIGN = "01a1d77f-5e23-7a9a-9112-a6f7089f329f";
export const LEAD = "01a1d77f-5156-7723-b616-dca4fb991449";
export const LIST = "01a1d77f-5e53-7eb1-ad45-7031e944ef51";
export const THREAD = "01a1d77f-5e65-78a7-8eb0-021717740220";
export const SENDER = "person1@example.com";

/** The leads the email fixtures name, by address. */
const REPLIERS = new Set([
  "person6@example.com",
  "person16@example.com",
  "person26@example.com",
  "person31@example.com",
]);

// A request that carries a cursor gets the last page.
const paged = (name: string) => (request: RouteRequest) => {
  const body = request.body as { starting_after?: string } | undefined;

  const cursor =
    request.url.searchParams.get("starting_after") ?? body?.starting_after;

  return cursor ? `${name}.page2.json` : `${name}.json`;
};

export const suite: AdapterSuite = {
  ids: {
    campaign: CAMPAIGN,
    lead: LEAD,
    list: LIST,
    sender: SENDER,
    thread: THREAD,
    webhook: "01a1d77f-5ea4-7b53-a085-00338a94f591",
  },
  isAuthorized: (request) => request.headers.authorization === `Bearer ${KEY}`,
  make: () => instantly({ apiKey: KEY, workspaceId: "client-a" }),
  origin: "https://api.instantly.ai",
  provider: "instantly",
  routes: [
    {
      fixture: paged("listInboxPlacementTests"),
      method: "GET",
      path: "/api/v2/inbox-placement-tests",
    },
    {
      fixture: "getLeadListVerificationStats.json",
      method: "GET",
      path: /^\/api\/v2\/lead-lists\/[^/]+\/verification-stats$/u,
    },
    {
      fixture: "getLeadList.json",
      method: "GET",
      path: /^\/api\/v2\/lead-lists\/[^/]+$/u,
    },
    {
      fixture: "getWebhook.json",
      method: "GET",
      path: /^\/api\/v2\/webhooks\/[^/]+$/u,
    },
    {
      fixture: "getCampaignsAnalytics.json",
      method: "GET",
      path: "/api/v2/campaigns/analytics",
    },
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
      fixture: paged("listAccountCampaignMappings"),
      method: "GET",
      path: /^\/api\/v2\/account-campaign-mappings\/[^/]+$/u,
    },
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
    {
      // A request with `contacts` is a lookup by email address. The leads the
      // email fixtures name have their own answer.
      fixture: (request) => {
        const contacts = (request.body as { contacts?: string[] } | undefined)
          ?.contacts;

        if (contacts?.some((address) => REPLIERS.has(address)) === true) {
          return "listLeadsByEmail.repliers.json";
        }

        return paged(contacts ? "listLeadsByEmail" : "listLeads")(request);
      },
      method: "POST",
      path: "/api/v2/leads/list",
    },
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
      fixture: "getEmail.json",
      method: "GET",
      path: /^\/api\/v2\/emails\/[\w-]+$/u,
    },
    {
      fixture: "listCustomTagMappings.json",
      method: "GET",
      path: "/api/v2/custom-tag-mappings",
    },
    {
      // A lookup by tag ids answers on one page, with a next marker all the same.
      fixture: (request) =>
        request.url.searchParams.has("tag_ids")
          ? "listCustomTags.byIds.json"
          : paged("listCustomTags")(request),
      method: "GET",
      path: "/api/v2/custom-tags",
    },
    {
      fixture: "listLeadLabels.json",
      method: "GET",
      path: "/api/v2/lead-labels",
    },
    {
      fixture: paged("listSubsequences"),
      method: "GET",
      path: "/api/v2/subsequences",
    },
    {
      fixture: paged("listLeadLists"),
      method: "GET",
      path: "/api/v2/lead-lists",
    },
    {
      fixture: paged("listBlockListEntries"),
      method: "GET",
      path: "/api/v2/block-lists-entries",
    },
    {
      fixture: paged("listWebhooks"),
      method: "GET",
      path: "/api/v2/webhooks",
    },
    {
      fixture: "testAccountVitals.json",
      method: "POST",
      path: "/api/v2/accounts/test/vitals",
    },
    {
      fixture: "getAccountWarmupAnalytics.json",
      method: "POST",
      path: "/api/v2/accounts/warmup-analytics",
    },
    {
      fixture: "getCurrentWorkspace.json",
      method: "GET",
      path: "/api/v2/workspaces/current",
    },
  ],
  secret: KEY,
  unsampled: {
    lead: {
      linkedinUrl:
        "Instantly has no profile field; it is read from a custom field named like one, which the documented examples do not carry. identity-links.test.ts reads it",
    },
    message: {
      isAuto:
        "listEmails.json holds sent emails only; auto-replies.test.ts reads received ones",
      isAutoSource:
        "listEmails.json holds sent emails only; auto-replies.test.ts reads received ones",
      senderRef:
        "the documented example's eaccount is the placeholder eaccount-123, not an address",
    },
    reply: {
      senderRef:
        "the documented example's eaccount is the placeholder eaccount-123, not an address",
    },
  },
  totals: {
    blocklist: 3,
    campaigns: 3,
    leads: 3,
    lists: 3,
    messages: 3,
    replies: 3,
    senders: 3,
    subsequences: 3,
    tags: 3,
    webhooks: 3,
  },
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
