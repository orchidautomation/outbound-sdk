// Every EmailBison read that has no normalized form, by name. A native read
// returns the vendor's payload as sent. site/content/docs/coverage/emailbison.mdx
// lists every endpoint EmailBison documents and which of these reads it.
//
// Left out on purpose, because they return secrets: a mailbox's OAuth access
// token and the workspace reads, which carry the webhook signing secret.
// Lists answer 15 records per page; `page` or, where the reference documents
// it, `pagination_type=cursor` with `cursor` walk them.

import {
  defineNative,
  inPath,
  inQuery,
  inQueryRequired,
} from "../internal/native.ts";
import type { NativeParam } from "../internal/native.ts";
import { docs, page } from "./native-params.ts";
import { WORKSPACE_NATIVE } from "./native-workspace.ts";

const cursor = {
  cursor: inQuery("string", "meta.next_cursor of the previous page."),
  pagination_type: inQuery(
    "string",
    "cursor to page by cursor, length_aware (the default) to page by number."
  ),
  ...page,
} as const satisfies Record<string, NativeParam>;

const range = {
  end_date: inQueryRequired("string", "The last day, as YYYY-MM-DD."),
  start_date: inQueryRequired("string", "The first day, as YYYY-MM-DD."),
} as const satisfies Record<string, NativeParam>;

const replyFilters = {
  ...cursor,
  folder: inQuery("string", "inbox, sent, spam, bounced or all."),
  lead_id: inQuery("number", "Only this lead's messages."),
  read: inQuery("boolean", "true for read messages, false for unread ones."),
  search: inQuery("string", "Text to search for."),
  status: inQuery(
    "string",
    "interested, automated_reply or not_automated_reply."
  ),
  "tag_ids[]": inQuery("list", "Only messages from leads with these tag ids."),
} as const satisfies Record<string, NativeParam>;

const scheduleDay = {
  day: inQuery("string", "The day to show: today, tomorrow, or a date."),
} as const satisfies Record<string, NativeParam>;

const CAMPAIGN_NATIVE = defineNative({
  campaignReplies: {
    description:
      "A campaign's master inbox messages, filtered by folder, status, read state, sender, lead or lead tag.",
    docs: docs("campaigns", "get", "/api/campaigns/{campaign_id}/replies"),
    method: "GET",
    params: {
      campaign_id: inPath("The campaign's id."),
      ...replyFilters,
      sender_email_id: inQuery("number", "Only this sender's messages."),
    },
    path: "/api/campaigns/{campaign_id}/replies",
  },
  campaignScheduledEmails: {
    description:
      "A campaign's emails in every state (scheduled, sent, failed, paused, stopped, bounced, unsubscribed), each with its lead and sender.",
    docs: docs(
      "campaigns",
      "get",
      "/api/campaigns/{campaign_id}/scheduled-emails"
    ),
    method: "GET",
    params: {
      campaign_id: inPath("The campaign's id."),
      ...cursor,
      scheduled_date: inQuery("string", "Only emails scheduled for this date."),
      scheduled_date_local: inQuery(
        "string",
        "Only emails scheduled for this date, in the campaign's timezone."
      ),
      status: inQuery("string", "Only emails in this state."),
    },
    path: "/api/campaigns/{campaign_id}/scheduled-emails",
  },
  campaignSendingSchedule: {
    description:
      "How many emails one campaign is set to send on a day, by sender.",
    docs: docs(
      "campaigns",
      "get",
      "/api/campaigns/{campaign_id}/sending-schedule"
    ),
    method: "GET",
    params: { campaign_id: inPath("The campaign's id."), ...scheduleDay },
    path: "/api/campaigns/{campaign_id}/sending-schedule",
  },
  scheduleTemplates: {
    description:
      "The saved schedule templates a campaign's sending window can be made from.",
    docs: docs("campaigns", "get", "/api/campaigns/schedule/templates"),
    method: "GET",
    path: "/api/campaigns/schedule/templates",
  },
  scheduleTimezones: {
    description: "The timezones a campaign schedule accepts, with their ids.",
    docs: docs(
      "campaigns",
      "get",
      "/api/campaigns/schedule/available-timezones"
    ),
    method: "GET",
    path: "/api/campaigns/schedule/available-timezones",
  },
  sendingSchedules: {
    description:
      "How many emails each campaign is set to send on a day, by sender.",
    docs: docs("campaigns", "get", "/api/campaigns/sending-schedules"),
    method: "GET",
    params: scheduleDay,
    path: "/api/campaigns/sending-schedules",
  },
});

const MAIL_NATIVE = defineNative({
  campaignEventStats: {
    description:
      "Daily counts of sends, opens, replies, bounces, unsubscribes and interested leads, for chosen campaigns and senders.",
    docs: docs("campaign-events", "get", "/api/campaign-events/stats"),
    method: "GET",
    params: {
      ...range,
      "campaign_ids[]": inQuery("list", "Only these campaigns."),
      "sender_email_ids[]": inQuery("list", "Only these senders."),
    },
    path: "/api/campaign-events/stats",
  },
  leadScheduledEmails: {
    description:
      "A lead's campaign emails in every state: scheduled, paused, stopped, bounced, unsubscribed or replied.",
    docs: docs("leads", "get", "/api/leads/{lead_id}/scheduled-emails"),
    method: "GET",
    params: { lead_id: inPath("The lead's id or email.") },
    path: "/api/leads/{lead_id}/scheduled-emails",
  },
  reply: {
    description:
      "One master inbox message with its lead, bodies, recipients and attachments.",
    docs: docs("replies", "get", "/api/replies/{id}"),
    method: "GET",
    params: { id: inPath("The reply's id.") },
    path: "/api/replies/{id}",
  },
  scheduledEmail: {
    description:
      "One campaign email: its state, times, counts, and the campaign, lead and sender it belongs to.",
    docs: docs("scheduled-emails", "get", "/api/scheduled-emails/{id}"),
    method: "GET",
    params: { id: inPath("The scheduled email's id.") },
    path: "/api/scheduled-emails/{id}",
  },
  scheduledEmails: {
    description:
      "Campaign emails across the workspace in any state, filtered by campaign, lead, sender and scheduled day.",
    docs: docs("scheduled-emails", "get", "/api/scheduled-emails"),
    method: "GET",
    params: {
      ...cursor,
      "campaign_ids[]": inQuery("list", "Only these campaigns."),
      "lead_ids[]": inQuery("list", "Only these leads."),
      "scheduled_date_local[criteria]": inQuery(
        "string",
        "How to compare the day: <, <=, =, >= or >."
      ),
      "scheduled_date_local[value]": inQuery(
        "string",
        "The day, as YYYY-MM-DD in the campaign's timezone."
      ),
      "sender_email_ids[]": inQuery("list", "Only these senders."),
      status: inQuery(
        "string",
        "sent, scheduled, failed, paused, stopped, bounced or unsubscribed."
      ),
    },
    path: "/api/scheduled-emails",
  },
  senderReplies: {
    description:
      "One sender's master inbox messages, with the same filters as the inbox.",
    docs: docs(
      "email-accounts",
      "get",
      "/api/sender-emails/{senderEmailId}/replies"
    ),
    method: "GET",
    params: {
      senderEmailId: inPath("The sender's id."),
      ...replyFilters,
      campaign_id: inQuery("number", "Only this campaign's messages."),
    },
    path: "/api/sender-emails/{senderEmailId}/replies",
  },
  warmupSenders: {
    description:
      "Every sender with its warmup counts and score between two days, filtered by tag, warmup state and MX records.",
    docs: docs("warmup", "get", "/api/warmup/sender-emails"),
    method: "GET",
    params: {
      ...cursor,
      ...range,
      "excluded_tag_ids[]": inQuery(
        "list",
        "Leave out senders with these tags."
      ),
      mx_records_status: inQuery("string", "records missing or records valid."),
      search: inQuery("string", "Text to search for."),
      "tag_ids[]": inQuery("list", "Only senders with these tag ids."),
      warmup_status: inQuery("string", "enabled or disabled."),
      without_tags: inQuery("boolean", "Only senders with no tags."),
    },
    path: "/api/warmup/sender-emails",
  },
});

export const NATIVE = defineNative({
  ...CAMPAIGN_NATIVE,
  ...MAIL_NATIVE,
  ...WORKSPACE_NATIVE,
});

export type EmailBisonNative = typeof NATIVE;
