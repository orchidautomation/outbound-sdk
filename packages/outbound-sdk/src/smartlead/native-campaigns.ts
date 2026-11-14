// Smartlead's own reads about campaigns, leads, clients and webhooks that
// have no normalized form.

import { defineNative } from "../internal/native.ts";
import { LEAD_STATISTICS_LANE } from "./capabilities.ts";
import {
  body,
  bodyRequired,
  DOCS,
  paged,
  path,
  query,
  queryRequired,
} from "./native-params.ts";

const CAMPAIGN = { campaign_id: path("The campaign's id.") };

export const CAMPAIGN_READS = defineNative({
  campaignEmailStatistics: {
    description:
      "One row per email a campaign sent: the lead, the step, and when it was sent, opened, clicked, replied to or bounced.",
    docs: `${DOCS}/campaign-statistics/get-by-id`,
    method: "GET",
    params: {
      ...CAMPAIGN,
      ...paged("Rows per page, at most 1000."),
      email_sequence_number: query("number", "Only this step, 1 to 20."),
      email_status: query(
        "string",
        "opened, clicked, replied, unsubscribed or bounced."
      ),
      sent_time_end_date: query(
        "string",
        "Sent before this time, as 2023-10-16 10:33:02.000Z."
      ),
      sent_time_start_date: query(
        "string",
        "Sent after this time, as 2023-10-16 10:33:02.000Z."
      ),
    },
    path: "/campaigns/{campaign_id}/statistics",
  },
  campaignLeadSearch: {
    description:
      "A campaign's leads filtered by text, status, category, mailbox or step. Refuses client-level keys.",
    docs: `${DOCS}/campaigns/search-leads`,
    method: "POST",
    params: {
      campaignId: path("The campaign's id."),
      deletedEmailAddresses: body("json", "Email addresses, as an array."),
      emailAccountIds: body("json", "Mailbox ids the leads are assigned to."),
      emailStatuses: body(
        "json",
        "Array of is_opened, is_clicked, is_bounced, is_replied, is_unsubscribed, is_accepted, not_replied and the like."
      ),
      espDomainTypes: body("json", "ESP domain types, integers 0 to 2."),
      fieldSet: body(
        "string",
        "drafted_table (compact) or active_table (full)."
      ),
      filterLeadsForManualCompletion: body(
        "boolean",
        "Only leads waiting on a manual step."
      ),
      filterManualSeqIds: body(
        "json",
        "Manual step ids, with filterLeadsForManualCompletion."
      ),
      includeSenderBounce: body("boolean", "Include sender-bounced leads."),
      lastSeenLeadId: body(
        "number",
        "Cursor: lastSeenEclmId from the previous page."
      ),
      lastSeenReplyTime: body(
        "string",
        "Second half of the cursor for active_table with statusFilter replied."
      ),
      leadCategoryIds: body(
        "json",
        "Lead category ids; -1 also matches leads with none."
      ),
      leadCategoryIsNull: body("boolean", "Only leads with no category."),
      leadStatuses: body(
        "json",
        "Array of STARTED, INPROGRESS, COMPLETED, STOPPED, PAUSED, BLOCKED."
      ),
      limit: body("number", "Leads per page, 1 to 100."),
      searchText: body(
        "string",
        "Every word must match the email, first name or last name."
      ),
      segTypes: body("json", "Segment types, integers 0 to 10."),
      seqScheduleType: body("string", "MANUAL or AUTO."),
      seqVariantIds: body("json", "Step variant ids."),
      sequenceIds: body("json", "Step ids."),
      sequenceNumbers: body("json", "Step numbers, 1 to 999."),
      statusFilter: body(
        "string",
        "A status tab: all, active, replied, failed, scheduled and the like."
      ),
    },
    path: "/campaigns/{campaignId}/leads/filter",
  },
  campaignLeadStatistics: {
    description:
      "Per-lead statistics of a campaign. The response is documented nowhere.",
    docs: `${DOCS}/campaign-statistics/lead-statistics`,
    lane: LEAD_STATISTICS_LANE,
    method: "GET",
    params: {
      ...CAMPAIGN,
      ...paged("Leads per page, at most 100."),
      event_time_gt: query(
        "string",
        "Only leads whose last event is after this day, YYYY-MM-DD."
      ),
    },
    path: "/campaigns/{campaign_id}/leads-statistics",
  },
  campaignLeadsExport: {
    description:
      "Every lead of a campaign as CSV text, with open, click and reply counts per lead.",
    docs: `${DOCS}/leads/export`,
    method: "GET",
    params: CAMPAIGN,
    path: "/campaigns/{campaign_id}/leads-export",
  },
  campaignMailboxStatistics: {
    description:
      "A campaign's results per mailbox. The response is documented nowhere.",
    docs: `${DOCS}/campaign-statistics/mailbox-statistics`,
    method: "GET",
    params: {
      ...CAMPAIGN,
      ...paged("Rows per page, 1 to 20."),
      client_id: query("number", "The client, for a client's campaign."),
      end_date: query("string", "Last day, YYYY-MM-DD; needs start_date."),
      start_date: query("string", "First day, YYYY-MM-DD; needs end_date."),
      time_zone: query("string", "The campaign's IANA time zone."),
    },
    path: "/campaigns/{campaign_id}/mailbox-statistics",
  },
  campaignMessageHistoryBulk: {
    description: "The message history of many of a campaign's leads at once.",
    docs: `${DOCS}/campaigns/get-leads-history-bulk`,
    method: "POST",
    params: {
      ...CAMPAIGN,
      event_time_gt: query("string", "Only messages after this time."),
      lead_ids: body("json", "Lead ids, as an array; null for every lead."),
    },
    path: "/campaigns/{campaign_id}/message-history-for-leads/bbfbdsFGHlBr76ruhjvh6fhHL",
  },
  campaignPromptTemplate: {
    description:
      "The AI prompt that categorises a campaign's replies, and the categories it may assign.",
    docs: `${DOCS}/campaigns/get-prompt-template`,
    method: "GET",
    params: CAMPAIGN,
    path: "/campaigns/{campaign_id}/prompt-template",
  },
  campaignTopLevelAnalyticsByDate: {
    description:
      "A campaign's top-level totals and rates in a date window, as the vendor computes them.",
    docs: `${DOCS}/campaign-statistics/top-level-by-date`,
    method: "GET",
    params: {
      ...CAMPAIGN,
      end_date: queryRequired("string", "Last day, YYYY-MM-DD."),
      start_date: queryRequired("string", "First day, YYYY-MM-DD."),
    },
    path: "/campaigns/{campaign_id}/top-level-analytics-by-date",
  },
  campaignWebhookSummary: {
    description:
      "How many webhook calls a campaign made in a time window, and how many failed.",
    docs: `${DOCS}/campaigns/get-webhook-summary`,
    method: "GET",
    params: {
      campaignId: path("The campaign's id."),
      fromTime: queryRequired("string", "Start, as an ISO 8601 time."),
      toTime: queryRequired("string", "End, as an ISO 8601 time."),
    },
    path: "/campaigns/{campaignId}/webhooks/summary",
  },
  client: {
    description:
      "One client, with its permissions, credits and code snippets on request. Refuses client-level keys.",
    docs: `${DOCS}/clients/get-by-id`,
    method: "GET",
    params: {
      id: path("The client's id."),
      includeCodeIntegrations: query("boolean", "Add the code snippets."),
      includeCredits: query("boolean", "Add lead and email credits."),
      includePermissions: query("boolean", "Add the client's permissions."),
    },
    path: "/client/{id}",
  },
  leadByEmail: {
    description:
      "The lead with an email address and every campaign it is in. An unknown address returns an empty object.",
    docs: `${DOCS}/leads/get-by-email`,
    method: "GET",
    params: { email: queryRequired("string", "The lead's email address.") },
    path: "/leads/",
  },
  leadCampaignOverview: {
    description:
      "A lead's status, category, revenue and current step in each of its campaigns. Refuses client-level keys.",
    docs: `${DOCS}/leads/campaign-overview`,
    method: "GET",
    params: { leadId: path("The lead's id.") },
    path: "/leads/{leadId}/campaign-overview",
  },
  leadList: {
    description: "One lead list: its name, lead count and dates.",
    docs: `${DOCS}/lead-lists/get-by-id`,
    method: "GET",
    params: { id: path("The lead list's id.") },
    path: "/lead-list/{id}",
  },
  leadNotes: {
    description: "The notes written on a lead.",
    docs: `${DOCS}/lead-notes/get-all`,
    method: "GET",
    params: { id: path("The lead's id.") },
    path: "/crm/leads/notes/{id}",
  },
  leadSequenceDetails: {
    description:
      "The send status of every step for a lead in a campaign. Refuses client-level keys.",
    docs: `${DOCS}/leads/sequence-details`,
    method: "GET",
    params: {
      campaignId: query("number", "Only this campaign."),
      leadMapId: path("The lead-in-campaign mapping id."),
    },
    path: "/leads/{leadMapId}/sequence-details",
  },
  leadTasks: {
    description: "The tasks created for a lead.",
    docs: `${DOCS}/lead-tasks/get-all`,
    method: "GET",
    params: { id: path("The lead's id.") },
    path: "/crm/leads/tasks/{id}",
  },
  senderTagsByEmail: {
    description: "The tags of the mailboxes with the given addresses.",
    docs: `${DOCS}/email-account-tags/get-all`,
    method: "POST",
    params: {
      email_ids: bodyRequired("json", "Mailbox addresses, as an array."),
    },
    path: "/email-accounts/tag-list",
  },
  webhook: {
    description: "One webhook: its URL, events, categories and campaign.",
    docs: `${DOCS}/webhooks/get`,
    method: "GET",
    params: { webhook_id: path("The webhook's id.") },
    path: "/webhook/{webhook_id}",
  },
});
