// The master inbox views other than replies, which `replies.list` reads. Each
// returns at most 20 threads per page and takes the same filter object.

import { defineNative } from "../internal/native.ts";
import { body, DOCS, query, queryRequired } from "./native-params.ts";

const PAGE = {
  limit: body("number", "Threads per page, 1 to 20."),
  offset: body("number", "Threads to skip."),
};

const HISTORY = {
  fetch_message_history: query("boolean", "Add each thread's messages."),
};

const FILTERS =
  "search, leadCategories, emailStatus, campaignId, emailAccountId, campaignTeamMemberId, campaignTagId, campaignClientId and replyTimeBetween";

const filters = (note: string) => ({
  filters: body("json", `An object of ${FILTERS}. ${note}`),
});

const MANY = filters("Ids may be arrays: 5 campaigns, 10 of the others.");
const SINGLE = filters("Each id is a single value.");

const SORT = {
  sortBy: body("string", "REPLY_TIME_DESC or SENT_TIME_DESC."),
};

export const INBOX = defineNative({
  inboxArchived: {
    description: "Archived threads of the master inbox.",
    docs: `${DOCS}/inbox/get-archived`,
    method: "POST",
    params: { ...PAGE, ...HISTORY, ...MANY, ...SORT },
    path: "/master-inbox/archived",
  },
  inboxAssignedToMe: {
    description: "Threads assigned to the key's own user.",
    docs: `${DOCS}/inbox/get-assigned`,
    method: "POST",
    params: { ...PAGE, ...HISTORY, ...SINGLE, ...SORT },
    path: "/master-inbox/assigned-me",
  },
  inboxImportant: {
    description: "Threads marked as important.",
    docs: `${DOCS}/inbox/get-important`,
    method: "POST",
    params: { ...PAGE, ...HISTORY, ...MANY, ...SORT },
    path: "/master-inbox/important",
  },
  inboxReminders: {
    description: "Threads with a reminder, with its time and message.",
    docs: `${DOCS}/inbox/get-reminders`,
    method: "POST",
    params: {
      ...PAGE,
      ...MANY,
      sortBy: body("string", "REMINDER_TIME_ASC or REMINDER_TIME_DESC."),
    },
    path: "/master-inbox/reminders",
  },
  inboxScheduled: {
    description: "Emails queued to be sent later, with their scheduled time.",
    docs: `${DOCS}/inbox/get-scheduled`,
    method: "POST",
    params: {
      ...PAGE,
      ...HISTORY,
      ...MANY,
      sortBy: body("string", "SCHEDULED_TIME_ASC or SCHEDULED_TIME_DESC."),
    },
    path: "/master-inbox/scheduled",
  },
  inboxSent: {
    description: "Sent emails across every campaign, one thread per row.",
    docs: `${DOCS}/inbox/get-sent`,
    method: "POST",
    params: { ...PAGE, ...MANY, ...SORT },
    path: "/master-inbox/sent",
  },
  inboxSnoozed: {
    description: "Threads snoozed for later.",
    docs: `${DOCS}/inbox/get-snoozed`,
    method: "POST",
    params: { ...PAGE, ...HISTORY, ...MANY, ...SORT },
    path: "/master-inbox/snoozed",
  },
  inboxUnread: {
    description: "Threads with an unread reply.",
    docs: `${DOCS}/inbox/get-unread`,
    method: "POST",
    params: { ...PAGE, ...HISTORY, ...MANY, ...SORT },
    path: "/master-inbox/unread-replies",
  },
  inboxUntrackedReplies: {
    description:
      "Replies that reached a connected mailbox but belong to no campaign.",
    docs: `${DOCS}/inbox/get-untracked`,
    method: "GET",
    params: {
      fetchAttachments: query("boolean", "Add attachment details."),
      fetchBody: query("boolean", "Add each email's body."),
      from_email: query("string", "Only from this address."),
      limit: query("number", "Replies per page, 1 to 100."),
      offset: query("number", "Replies to skip."),
      subject_line: query("string", "Only subjects containing this."),
      to_email: query("string", "Only to this address."),
    },
    path: "/master-inbox/untracked-replies",
  },
  inboxView: {
    description:
      "Threads matching a custom view: the inbox filters plus a subsequence.",
    docs: `${DOCS}/inbox/get-views`,
    method: "POST",
    params: {
      ...PAGE,
      ...HISTORY,
      ...filters("Each id is a single value; subSequenceId is also taken."),
      ...SORT,
    },
    path: "/master-inbox/views",
  },
  replyStatus: {
    description:
      "Whether a reply sent from the master inbox was delivered, and when.",
    docs: `${DOCS}/inbox/reply-status`,
    method: "GET",
    params: {
      message_id: queryRequired(
        "string",
        "The reply's Message-ID header, angle brackets included."
      ),
    },
    path: "/master-inbox/reply-status",
  },
});
