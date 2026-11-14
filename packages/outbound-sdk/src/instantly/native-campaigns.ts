// Campaigns and subsequences: analytics, sending status and exports that have no normalized read.
// Each entry is one read Instantly documents; site/content/docs/coverage/instantly.mdx lists them all.

import {
  defineNative,
  inPath,
  inQuery,
  inQueryRequired,
} from "../internal/native.ts";
import { docs, PAGE } from "./native-params.ts";

export const CAMPAIGN_READS = defineNative({
  campaignAnalytics: {
    description:
      "Totals for one campaign or for every campaign, one row per campaign.",
    docs: docs("campaign/get-campaigns-analytics"),
    method: "GET",
    params: {
      end_date: inQuery("string", "Last day, YYYY-MM-DD or an ISO 8601 time."),
      exclude_total_leads_count: inQuery(
        "boolean",
        "Leave out the lead count, which makes the answer much faster."
      ),
      id: inQuery("string", "One campaign. Leave out for every campaign."),
      ids: inQuery("list", "Only these campaigns, by id."),
      start_date: inQuery(
        "string",
        "First day, YYYY-MM-DD or an ISO 8601 time."
      ),
    },
    path: "/campaigns/analytics",
  },
  campaignExport: {
    description:
      "One campaign as the JSON Instantly exports: schedule, sequences and settings.",
    docs: docs("campaign/export-campaign-to-json-format"),
    method: "POST",
    params: {
      id: inPath("The campaign."),
    },
    path: "/campaigns/{id}/export",
  },
  campaignSendingStatus: {
    description:
      "Why a campaign is not sending, or is sending slower than expected.",
    docs: docs("campaign/get-campaign-sending-status"),
    method: "GET",
    params: {
      id: inPath("The campaign."),
      with_ai_summary: inQuery("boolean", "Add an AI-written summary."),
    },
    path: "/campaigns/{id}/sending-status",
  },
  campaignsByLeadEmail: {
    description: "The campaigns a lead's email address is in.",
    docs: docs("campaign/search-campaigns-by-lead-email"),
    method: "GET",
    params: {
      search: inQuery("string", "The lead's email address."),
      sort_column: inQuery("string", "The column to sort by."),
      sort_order: inQuery("string", "asc or desc."),
    },
    path: "/campaigns/search-by-contact",
  },
  launchedCampaignCount: {
    description: "How many campaigns the workspace has launched.",
    docs: docs("campaign/get-launched-campaigns-count"),
    method: "GET",
    path: "/campaigns/count-launched",
  },
  senderCampaigns: {
    description: "The campaigns one mailbox sends for.",
    docs: docs("accountcampaignmapping/get-campaigns-associated-with-an-email"),
    method: "GET",
    params: {
      ...PAGE,
      email: inPath("The mailbox address."),
    },
    path: "/account-campaign-mappings/{email}",
  },
  subsequence: {
    description:
      "One subsequence: its trigger conditions, status, schedule and steps.",
    docs: docs("campaignsubsequence/get-campaign-subsequence"),
    method: "GET",
    params: {
      id: inPath("The subsequence."),
    },
    path: "/subsequences/{id}",
  },
  subsequenceAnalytics: {
    description:
      "Sent, unique opens and unique replies for each subsequence of a campaign.",
    docs: docs("campaignsubsequence/get-subsequence-analytics-summary"),
    method: "GET",
    params: {
      campaign_id: inQueryRequired("string", "The parent campaign."),
    },
    path: "/subsequences/analytics",
  },
  subsequenceSendingStatus: {
    description:
      "Why a subsequence is not sending, or is sending slower than expected.",
    docs: docs("campaignsubsequence/get-subsequence-sending-status"),
    method: "GET",
    params: {
      id: inPath("The subsequence."),
      with_ai_summary: inQuery("boolean", "Add an AI-written summary."),
    },
    path: "/subsequences/{id}/sending-status",
  },
  subsequenceStepAnalytics: {
    description:
      "One subsequence's numbers by step and variant, without its parent campaign.",
    docs: docs(
      "campaignsubsequence/get-subsequence-step-and-variant-analytics"
    ),
    method: "GET",
    params: {
      end_date: inQuery("string", "Last day, YYYY-MM-DD or an ISO 8601 time."),
      id: inPath("The subsequence."),
      start_date: inQuery(
        "string",
        "First day, YYYY-MM-DD or an ISO 8601 time."
      ),
    },
    path: "/subsequences/{id}/analytics/steps",
  },
});
