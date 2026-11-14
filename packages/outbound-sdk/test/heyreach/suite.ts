import { campaignLeads, heyreach } from "../../src/heyreach/index.ts";
import type { AdapterSuite, RouteRequest } from "../helpers/adapter-suite.ts";

export const KEY = "hr_test_key_0123456789abcdef";
export const CAMPAIGN = "274079";
export const SENDER = "1101";
export const LEAD = "https://www.linkedin.com/in/example-person-1";

// HeyReach pages by offset in the body; any offset past 0 is the last page.
const paged = (name: string) => (request: RouteRequest) => {
  const body = request.body as { offset?: number } | undefined;

  return (body?.offset ?? 0) > 0 ? `${name}.page2.json` : `${name}.json`;
};

export const suite: AdapterSuite = {
  ids: { campaign: CAMPAIGN, lead: LEAD, sender: SENDER },
  isAuthorized: (request) => request.headers["x-api-key"] === KEY,
  make: () => heyreach({ apiKey: KEY, workspaceId: "client-a" }),
  origin: "https://api.heyreach.io",
  provider: "heyreach",
  routes: [
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
      fixture: paged("getLeadsFromCampaign"),
      method: "POST",
      path: "/api/public/campaign/GetLeadsFromCampaign",
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
  totals: { campaigns: 3, senders: 3 },
  webhooks: {
    "webhook.message_sent.THIRD_PARTY.json": "linkedin.message_sent",
    "webhook.voice_note_received.json": "linkedin.message_received",
  },
};

/** The same suite with a campaign's leads turned on. */
export const withCampaignLeads: AdapterSuite = {
  ...suite,
  make: () =>
    heyreach({
      apiKey: KEY,
      capabilities: campaignLeads,
      workspaceId: "client-a",
    }),
};
