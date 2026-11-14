// Reads from Smartlead's sister services. Each runs on its own host, takes
// the same `api_key`, and is a separate product an account may not have:
// SmartDelivery (inbox placement tests), SmartProspect (the contact
// database), SmartSenders (bought domains) and SmartServers (dedicated IPs).

import { defineNative } from "../internal/native.ts";
import {
  body,
  DELIVERY_URL,
  DOCS,
  path,
  PROSPECT_URL,
  query,
  SENDERS_URL,
  SERVERS_URL,
} from "./native-params.ts";

const TEST = { spamTestId: path("The placement test's id.") };

export interface ServiceRead<Params> {
  readonly baseUrl: string;
  readonly description: string;
  readonly docs: string;
  readonly method: "GET";
  readonly params: Params;
  readonly path: string;
}

/** One part of a placement test's report. */
const report = (
  leaf: string,
  page: string,
  description: string
): ServiceRead<typeof TEST> => ({
  baseUrl: DELIVERY_URL,
  description,
  docs: `${DOCS}/smart-delivery/${page}`,
  method: "GET",
  params: TEST,
  path: `/spam-test/report/{spamTestId}/${leaf}`,
});

/** SmartProspect takes paging numbers as strings. */
const SEARCHES = {
  limit: query("string", "Searches per page; 10 by default."),
  offset: query("string", "Searches to skip."),
};

/** One of SmartProspect's lists of searches. */
const searches = (
  leaf: string,
  description: string
): ServiceRead<typeof SEARCHES> => ({
  baseUrl: PROSPECT_URL,
  description,
  docs: `${DOCS}/smart-prospect/${leaf}`,
  method: "GET",
  params: SEARCHES,
  path: `/search-email-leads/search-filters/${leaf}`,
});

export const DELIVERY = defineNative({
  deliveryDkimDetails: report(
    "dkim-details",
    "dkim-details",
    "The DKIM result of each sender in a placement test."
  ),
  deliveryDomainBlacklist: report(
    "domain-blacklist",
    "domain-blacklist",
    "Whether a placement test's sending domains are on a block list."
  ),
  deliveryEmailContent: report(
    "email-content",
    "test-email-content",
    "The email a placement test sent."
  ),
  deliveryFolder: {
    baseUrl: DELIVERY_URL,
    description: "One folder of placement tests.",
    docs: `${DOCS}/smart-delivery/get-folder-by-id`,
    method: "GET",
    params: { folderId: path("The folder's id.") },
    path: "/spam-test/folder/{folderId}",
  },
  deliveryFolders: {
    baseUrl: DELIVERY_URL,
    description: "The folders that organize placement tests.",
    docs: `${DOCS}/smart-delivery/get-folders`,
    method: "GET",
    path: "/spam-test/folder",
  },
  deliveryGeoReport: {
    baseUrl: DELIVERY_URL,
    description: "A placement test's inbox and spam rates per region.",
    docs: `${DOCS}/smart-delivery/geo-report`,
    method: "POST",
    params: TEST,
    path: "/spam-test/report/{spamTestId}/groupwise",
  },
  deliveryIpBlacklist: report(
    "blacklist",
    "blacklists",
    "Whether a placement test's sending IPs are on a block list, per seed mailbox."
  ),
  deliveryIpDetails: report(
    "ip-analytics",
    "ip-details",
    "The sending IP addresses a placement test saw."
  ),
  deliveryMailboxCount: {
    baseUrl: DELIVERY_URL,
    description: "How many test mailboxes there are per provider.",
    docs: `${DOCS}/smart-delivery/mailbox-count`,
    method: "GET",
    path: "/spam-test/report/mailboxes-count",
  },
  deliveryMailboxSummary: {
    baseUrl: DELIVERY_URL,
    description: "A summary of every test mailbox.",
    docs: `${DOCS}/smart-delivery/mailbox-summary`,
    method: "GET",
    path: "/spam-test/report/mailboxes-summary",
  },
  deliveryProviderReport: {
    baseUrl: DELIVERY_URL,
    description:
      "A placement test's inbox, spam and bounce rates per mailbox provider.",
    docs: `${DOCS}/smart-delivery/provider-report`,
    method: "POST",
    params: TEST,
    path: "/spam-test/report/{spamTestId}/providerwise",
  },
  deliveryRdnsDetails: report(
    "rdns-details",
    "rdns-report",
    "The reverse DNS of a placement test's sending IPs."
  ),
  deliveryReplyHeaders: {
    baseUrl: DELIVERY_URL,
    description: "The headers of one email a placement test received.",
    docs: `${DOCS}/smart-delivery/reply-headers`,
    method: "GET",
    params: { ...TEST, replyId: path("The received email's reply id.") },
    path: "/spam-test/report/{spamTestId}/sender-account-wise/{replyId}/email-headers",
  },
  deliveryScheduleHistory: report(
    "schedule-history",
    "schedule-history",
    "The runs of an automated placement test."
  ),
  deliverySeedProviders: {
    baseUrl: DELIVERY_URL,
    description:
      "The mailbox provider ids per region that placement tests refer to.",
    docs: `${DOCS}/smart-delivery/provider-ids`,
    method: "GET",
    path: "/spam-test/seed/providers",
  },
  deliverySenderAccounts: report(
    "sender-accounts",
    "sender-list",
    "The sender mailboxes of a placement test."
  ),
  deliverySenderReport: report(
    "sender-account-wise",
    "sender-report",
    "A placement test's results per sender mailbox."
  ),
  deliverySpamFilterDetails: report(
    "spam-filter-details",
    "spam-filter-report",
    "Which spam filters a placement test's emails triggered, and why."
  ),
  deliverySpfDetails: report(
    "spf-details",
    "spf-details",
    "The SPF result of each sender in a placement test."
  ),
  deliveryTest: {
    baseUrl: DELIVERY_URL,
    description: "One placement test: its type, campaign, step and provider.",
    docs: `${DOCS}/smart-delivery/test-details`,
    method: "GET",
    params: TEST,
    path: "/spam-test/{spamTestId}",
  },
  deliveryTests: {
    baseUrl: DELIVERY_URL,
    description: "Every placement test, with its status and schedule.",
    docs: `${DOCS}/smart-delivery/list-tests`,
    method: "POST",
    path: "/spam-test/report",
  },
});

export const SERVICES = defineNative({
  prospectContacts: {
    baseUrl: PROSPECT_URL,
    description:
      "Contacts already saved from SmartProspect, by search filter or by id. Takes filter_id or id, not both.",
    docs: `${DOCS}/smart-prospect/get-contacts`,
    method: "POST",
    params: {
      catch_all_status: body(
        "string",
        "catch_all_verified, catch_all_soft_bounced, catch_all_hard_bounced, catch_all_unknown or catch_all_bounced."
      ),
      filter_id: body("number", "The search filter whose contacts to read."),
      id: body("json", "Contact ids (adapt_ids), as an array of at most 200."),
      limit: body("number", "Contacts per page, 1 to 1000, with filter_id."),
      offset: body("number", "Contacts to skip, with filter_id."),
      search: body("string", "Matches the first, last or full name."),
      verification_status: body("string", "valid, catch_all or invalid."),
    },
    path: "/search-email-leads/get-contacts",
  },
  prospectFetchedSearches: searches(
    "fetched-searches",
    "SmartProspect searches whose contacts were fetched, with their email counts."
  ),
  prospectRecentSearches: searches(
    "recent-searches",
    "The most recent SmartProspect searches."
  ),
  prospectReplyAnalytics: {
    baseUrl: PROSPECT_URL,
    description:
      "Replies from SmartProspect contacts this month against last month.",
    docs: `${DOCS}/smart-prospect/reply-analytics`,
    method: "GET",
    path: "/search-email-leads/reply-analytics",
  },
  prospectSavedSearches: searches(
    "saved-searches",
    "The saved SmartProspect searches."
  ),
  prospectSearchAnalytics: {
    baseUrl: PROSPECT_URL,
    description:
      "SmartProspect leads found, emails fetched and credits left, with the monthly trend.",
    docs: `${DOCS}/smart-prospect/search-analytics`,
    method: "GET",
    params: { filter_id: query("string", "Only this search filter.") },
    path: "/search-email-leads/search-analytics",
  },
  smartSendersDomains: {
    baseUrl: SENDERS_URL,
    description: "The sending domains bought through SmartSenders.",
    docs: `${DOCS}/smart-senders/domain-list`,
    method: "GET",
    path: "/smart-senders/get-domain-list",
  },
  smartServers: {
    baseUrl: SERVERS_URL,
    description:
      "The account's dedicated sending IPs, with the campaigns on each on request.",
    docs: `${DOCS}/smart-servers/list-servers`,
    method: "GET",
    params: {
      unmapped: query(
        "string",
        'Set to "true" for only servers on no campaign or client.'
      ),
      withCampaignData: query(
        "string",
        'Set to "true" to add each server\'s campaigns, client and region.'
      ),
    },
    path: "/smart-server/",
  },
  smartServersForCampaign: {
    baseUrl: SERVERS_URL,
    description:
      "The dedicated IP attached to a campaign; only one is returned when it has several.",
    docs: `${DOCS}/smart-servers/get-campaign-servers`,
    method: "GET",
    params: { campaign_id: path("The campaign's id.") },
    path: "/smart-server/all/campaign/{campaign_id}",
  },
});
