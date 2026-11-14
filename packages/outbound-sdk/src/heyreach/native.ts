// HeyReach's own reads that have no normalized form, by name. Together with
// the normalized reads they cover every read in HeyReach's API reference;
// docs/coverage/heyreach.md accounts for each endpoint.
//
// Ids are whole numbers. Lists page by `offset` and `limit` and answer
// `{ totalCount, items }` unless a description says otherwise.

import { defineNative } from "../internal/native.ts";
import type { NativeParam } from "../internal/native.ts";
import { ORGANIZATION_NATIVE } from "./native-organization.ts";
import { VOICE_NATIVE } from "./native-voice.ts";

const DOCS = "https://docs.heyreach.io/hey-reach-api";

const page = (what: string, max?: number) =>
  ({
    limit: {
      description: `How many ${what} to return${max === undefined ? "" : `, up to ${max}`}.`,
      in: "body",
      type: "number",
    },
    offset: {
      description: `How many ${what} to skip.`,
      in: "body",
      type: "number",
    },
  }) as const satisfies Record<string, NativeParam>;

// A lead is named by one of three keys.
const leadKeys = {
  email: {
    description: "The lead's email address.",
    in: "body",
    type: "string",
  },
  linkedinId: {
    description: "The lead's LinkedIn id, `linkedin_id` in lead payloads.",
    in: "body",
    type: "string",
  },
  profileUrl: {
    description: "The lead's LinkedIn profile URL.",
    in: "body",
    type: "string",
  },
} as const satisfies Record<string, NativeParam>;

const WORKSPACE_NATIVE = defineNative({
  campaignSequenceV2: {
    description:
      "A campaign's sequence tree with every message version in full, voice versions included, each with the length and transcript of its recording. Empty when the campaign has no sequence.",
    docs: `${DOCS}/campaigns/get-campaign-sequence-v-2`,
    method: "GET",
    params: {
      campaignId: {
        description: "The campaign's id.",
        in: "query",
        required: true,
        type: "number",
      },
    },
    path: "/campaign/GetCampaignSequenceV2",
  },
  campaignsForLead: {
    description:
      "The campaigns one lead is in, each with the campaign's status and the lead's status in it. Name the lead by email, LinkedIn id or profile URL.",
    docs: `${DOCS}/campaigns/get-campaigns-for-lead`,
    method: "POST",
    params: { ...leadKeys, ...page("campaigns") },
    path: "/campaign/GetCampaignsForLead",
  },
  checkApiKey: {
    description:
      "Whether the API key works. Answers 200 with an empty body, and nothing about who the key belongs to.",
    docs: `${DOCS}/authentication/check-api-key`,
    method: "GET",
    path: "/auth/CheckApiKey",
  },
  companiesFromList: {
    description:
      "The companies in one company list: name, industry, size, location and website.",
    docs: `${DOCS}/lists/get-companies-from-list`,
    method: "POST",
    params: {
      ...page("companies", 1000),
      keyword: {
        description: "Search text.",
        in: "body",
        type: "string",
      },
      listId: {
        description: "The company list's id.",
        in: "body",
        required: true,
        type: "number",
      },
    },
    path: "/list/GetCompaniesFromList",
  },
  conversationsV2: {
    description:
      "Conversations with their messages, paged by offset. Unlike the newer listing the normalized reads use, each lead profile here carries its custom fields. Deep pages are refused on a large inbox.",
    docs: `${DOCS}/inbox/get-conversations-v-2`,
    method: "POST",
    params: {
      ...page("conversations", 100),
      filters: {
        description:
          "An object of filters: linkedInAccountIds, campaignIds, searchString, leadLinkedInId, leadProfileUrl, tags, seen.",
        in: "body",
        type: "json",
      },
    },
    path: "/inbox/GetConversationsV2",
  },
  enrichEmailJob: {
    description:
      "The state of one email-enrichment job, and the email found once it has completed. The job itself is started in HeyReach.",
    docs: `${DOCS}/enrichment/check-enrich-email-job`,
    method: "GET",
    params: {
      jobId: {
        description: "The job's id.",
        in: "path",
        type: "number",
      },
    },
    path: "/enrichment/enrich-email/check-job/{jobId}",
  },
  isConnection: {
    description:
      "Whether a lead is a LinkedIn connection of one sender. Name the lead by profile URL or LinkedIn id, never both.",
    docs: `${DOCS}/my-network/is-connection`,
    method: "POST",
    params: {
      leadLinkedInId: {
        description: "The lead's LinkedIn id.",
        in: "body",
        type: "string",
      },
      leadProfileUrl: {
        description: "The lead's LinkedIn profile URL.",
        in: "body",
        type: "string",
      },
      senderAccountId: {
        description: "The LinkedIn account's id.",
        in: "body",
        required: true,
        type: "number",
      },
    },
    path: "/MyNetwork/IsConnection",
  },
  listById: {
    description:
      "One lead or company list: name, type, item count, creation time and the campaigns that use it.",
    docs: `${DOCS}/lists/get-by-id`,
    method: "GET",
    params: {
      listId: {
        description: "The list's id.",
        in: "query",
        required: true,
        type: "number",
      },
    },
    path: "/list/GetById",
  },
  listsForLead: {
    description:
      "The lead lists one lead is in. Name the lead by email, LinkedIn id or profile URL. Answers 404 when the lead is in none.",
    docs: `${DOCS}/lists/get-lists-for-lead`,
    method: "POST",
    params: { ...leadKeys, ...page("lists") },
    path: "/list/GetListsForLead",
  },
  myNetworkForSender: {
    description:
      "The LinkedIn connections of one sender, as lead profiles. Pages by pageNumber and pageSize.",
    docs: `${DOCS}/my-network/get-my-network-for-sender`,
    method: "POST",
    params: {
      pageNumber: {
        description: "The page to read, starting at 0.",
        in: "body",
        type: "number",
      },
      pageSize: {
        description:
          "How many connections a page holds. The documented example uses 100.",
        in: "body",
        type: "number",
      },
      senderId: {
        description: "The LinkedIn account's id.",
        in: "body",
        required: true,
        type: "number",
      },
    },
    path: "/MyNetwork/GetMyNetworkForSender",
  },
  proxyCountries: {
    description:
      "The proxy countries a LinkedIn account can be connected through.",
    docs: `${DOCS}/linked-in-accounts/get-proxy-countries`,
    method: "GET",
    path: "/li_account/GetProxyCountries",
  },
  statsByCampaign: {
    description:
      "The workspace's stats broken down per campaign: one row of counts for each campaign, in total and for each day, deleted campaigns included.",
    docs: `${DOCS}/analytics/get-overall-stats-by-campaign`,
    method: "POST",
    params: {
      accountIds: {
        description:
          "Only these LinkedIn accounts, as an array of ids. Empty means every account.",
        in: "body",
        required: true,
        type: "json",
      },
      campaignIds: {
        description:
          "Only these campaigns, as an array of ids. Empty means every campaign.",
        in: "body",
        required: true,
        type: "json",
      },
      endDate: {
        description: "The end of the range, as an ISO 8601 time.",
        in: "body",
        type: "string",
      },
      startDate: {
        description: "The start of the range, as an ISO 8601 time.",
        in: "body",
        type: "string",
      },
    },
    path: "/stats/GetOverallStatsByCampaign",
  },
  webhookById: {
    description:
      "One webhook: name, URL, event type, campaigns and whether it is active. Its custom headers can hold a secret, so they are never requested.",
    docs: `${DOCS}/webhooks/get-webhook-by-id`,
    method: "GET",
    params: {
      webhookId: {
        description: "The webhook's id.",
        in: "query",
        required: true,
        type: "number",
      },
    },
    path: "/webhooks/GetWebhookById",
  },
});

/** Every HeyReach read that has no normalized form. */
export const NATIVE = defineNative({
  ...WORKSPACE_NATIVE,
  ...ORGANIZATION_NATIVE,
  ...VOICE_NATIVE,
});

export type HeyReachNative = typeof NATIVE;
