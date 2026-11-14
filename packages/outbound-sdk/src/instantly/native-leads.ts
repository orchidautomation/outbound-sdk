// Tags, the block list, lead labels, lead lists, email verification and the Unibox count.
// Each entry is one read Instantly documents; site/content/docs/coverage/instantly.mdx lists them all.

import { defineNative } from "../internal/native.ts";
import { LABEL_PREDICTION_LANE } from "./capabilities.ts";
import {
  docs,
  inBody,
  inBodyRequired,
  inPath,
  inQuery,
} from "./native-params.ts";

export const LEAD_READS = defineNative({
  blocklistCsv: {
    description: "The whole block list as CSV text.",
    docs: docs("blocklistentry/download-all-block-list-entries-as-csv"),
    method: "GET",
    params: {
      domains_only: inQuery("boolean", "Only domain entries."),
      search: inQuery("string", "Only values that contain this text."),
    },
    path: "/block-lists-entries/download",
  },
  blocklistEntry: {
    description: "One block list entry.",
    docs: docs("blocklistentry/get-block-list-entry"),
    method: "GET",
    params: {
      id: inPath("The entry."),
    },
    path: "/block-lists-entries/{id}",
  },
  emailVerification: {
    description:
      "The result of an email verification that was started earlier.",
    docs: docs("emailverification/check-an-email-verification-status"),
    method: "GET",
    params: {
      email: inPath("The address that was verified."),
    },
    path: "/email-verification/{email}",
  },
  inboxUnreadCount: {
    description: "How many emails in the Unibox are unread.",
    docs: docs("email/count-unread-emails"),
    method: "GET",
    path: "/emails/unread/count",
  },
  leadLabel: {
    description: "One custom lead label and the interest status it stands for.",
    docs: docs("leadlabel/get-lead-label"),
    method: "GET",
    params: {
      id: inPath("The label."),
    },
    path: "/lead-labels/{id}",
  },
  leadLabelPrediction: {
    description:
      "The label Instantly's AI would give a reply text. Nothing is saved.",
    docs: docs("leadlabel/test-ai-reply-label-prediction"),
    lane: LABEL_PREDICTION_LANE,
    method: "POST",
    params: {
      reply_text: inBodyRequired("string", "The reply to classify."),
    },
    path: "/lead-labels/ai-reply-label",
  },
  leadList: {
    description: "One lead list.",
    docs: docs("leadlist/get-lead-list"),
    method: "GET",
    params: {
      id: inPath("The list."),
    },
    path: "/lead-lists/{id}",
  },
  leadListVerificationStats: {
    description:
      "How many leads a list holds and how their email verification came out.",
    docs: docs("leadlist/get-verification-statistics-for-a-lead-list"),
    method: "GET",
    params: {
      id: inPath("The list."),
    },
    path: "/lead-lists/{id}/verification-stats",
  },
  tag: {
    description: "One custom tag.",
    docs: docs("customtag/get-custom-tag"),
    method: "GET",
    params: {
      id: inPath("The tag."),
    },
    path: "/custom-tags/{id}",
  },
  tagsOfResources: {
    description:
      "The custom tags assigned to any of the given campaigns or mailboxes.",
    docs: docs("customtag/list-custom-tags-assigned-to-resources"),
    method: "POST",
    params: {
      limit: inBody("number", "Page size, 1 to 100."),
      resource_ids: inBodyRequired(
        "json",
        "Campaign ids or mailbox addresses."
      ),
      starting_after: inBody(
        "string",
        "The next_starting_after of the previous page."
      ),
    },
    path: "/custom-tags/search",
  },
});
