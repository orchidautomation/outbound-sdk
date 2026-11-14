import { heyreach } from "../../src/heyreach/index.ts";
import type { AdapterSuite, RouteRequest } from "../helpers/adapter-suite.ts";

export const KEY = "hr_test_key_0123456789abcdef";
export const CAMPAIGN = "274079";
export const SENDER = "1101";
export const LEAD = "https://www.linkedin.com/in/example-person-1";
export const LIST = "3457";

/** `<accountId>:<conversationId>`, as the conversation fixtures give it. */
export const THREAD = "4101:2-ExampleConversationId1==";

// HeyReach pages by offset in the body; any offset past 0 is the last page.
const paged = (name: string) => (request: RouteRequest) => {
  const body = request.body as { offset?: number } | undefined;

  return (body?.offset ?? 0) > 0 ? `${name}.page2.json` : `${name}.json`;
};

// Conversations page by cursor; a request that carries one gets the last page.
const conversations = (request: RouteRequest): string => {
  const body = request.body as { cursor?: string } | undefined;

  return body?.cursor === undefined
    ? "getConversations.json"
    : "getConversations.page2.json";
};

export const suite: AdapterSuite = {
  ids: {
    campaign: CAMPAIGN,
    lead: LEAD,
    list: LIST,
    sender: SENDER,
    thread: THREAD,
  },
  isAuthorized: (request) => request.headers["x-api-key"] === KEY,
  make: () => heyreach({ apiKey: KEY, workspaceId: "client-a" }),
  origin: "https://api.heyreach.io",
  provider: "heyreach",
  routes: [
    {
      fixture: "getBlacklistCompanies.json",
      method: "POST",
      path: "/api/public/blacklist/GetCompanies",
    },
    {
      fixture: paged("getBlacklistLeads"),
      method: "POST",
      path: "/api/public/blacklist/GetLeads",
    },
    {
      fixture: "getChatroom.json",
      method: "GET",
      path: "/api/public/inbox/GetChatroom/4101/2-ExampleConversationId1%3D%3D",
    },
    {
      fixture: "getLeadTags.json",
      method: "POST",
      path: "/api/public/lead/GetTags",
    },
    {
      fixture: "getAccountStatus.json",
      method: "GET",
      path: "/api/public/li_account/GetAccountStatus/1101",
    },
    {
      fixture: paged("listLists"),
      method: "POST",
      path: "/api/public/list/GetAll",
    },
    {
      fixture: paged("getLeadsFromList"),
      method: "POST",
      path: "/api/public/list/GetLeadsFromList",
    },
    {
      fixture: paged("listWebhooks"),
      method: "POST",
      path: "/api/public/webhooks/GetAllWebhooks",
    },
    {
      fixture: paged("listCampaigns"),
      method: "POST",
      path: "/api/public/campaign/GetAll",
    },
    {
      fixture: "getCampaign.json",
      method: "GET",
      path: "/api/public/campaign/GetById",
    },
    {
      fixture: "getCampaignSequence.json",
      method: "GET",
      path: "/api/public/campaign/GetCampaignSequence",
    },
    {
      fixture: paged("getCampaignsForLead"),
      method: "POST",
      path: "/api/public/campaign/GetCampaignsForLead",
    },
    {
      fixture: "getListsForLead.json",
      method: "POST",
      path: "/api/public/list/GetListsForLead",
    },
    {
      fixture: paged("getLeadsFromCampaign"),
      method: "POST",
      path: "/api/public/campaign/GetLeadsFromCampaign",
    },
    {
      fixture: conversations,
      method: "POST",
      path: "/api/public/inbox/GetConversationsV3",
    },
    {
      fixture: "getLead.json",
      method: "POST",
      path: "/api/public/lead/GetLead",
    },
    {
      fixture: paged("listLinkedInAccounts"),
      method: "POST",
      path: "/api/public/li_account/GetAll",
    },
    {
      fixture: "getLinkedInAccount.json",
      method: "GET",
      path: "/api/public/li_account/GetById",
    },
    {
      fixture: "getOverallStats.json",
      method: "POST",
      path: "/api/public/stats/GetOverallStats",
    },
  ],
  secret: KEY,
  unsampled: {
    metricRow: {
      contacted:
        "uniqueLeadsContacted was seen live and is not in the API reference, so the documented example has none",
      positive:
        "autoTaggedInterested was seen live and is not in the API reference, so the documented example has none",
    },
    reply: {
      category:
        "no documented conversation carries an auto-tag; fields.test.ts builds them",
      categorySource:
        "no documented conversation carries an auto-tag; fields.test.ts builds them",
      subject: "only an InMail has a subject, and no documented reply is one",
    },
  },
  totals: {
    blocklist: 5,
    campaigns: 3,
    leads: 3,
    lists: 3,
    messages: 6,
    replies: 2,
    senders: 3,
    webhooks: 3,
  },
  webhooks: {
    "webhook.message_sent.THIRD_PARTY.json": "linkedin.message_sent",
    "webhook.voice_note_received.json": "linkedin.message_received",
  },
};

/** Kept as its own name for the lead tests: a campaign's leads are on by default. */
export const withCampaignLeads: AdapterSuite = suite;
