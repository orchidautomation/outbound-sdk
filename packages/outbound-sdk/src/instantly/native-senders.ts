// Mailboxes and deliverability: tracking domains, done-for-you orders and inbox placement tests.
// Each entry is one read Instantly documents; site/content/docs/coverage/instantly.mdx lists them all.

import { defineNative } from "../internal/native.ts";
import {
  docs,
  inBody,
  inBodyRequired,
  inPath,
  inQuery,
  inQueryRequired,
  PAGE,
} from "./native-params.ts";

export const SENDER_READS = defineNative({
  crmPhoneNumbers: {
    description: "The phone numbers the workspace rents for calls and texts.",
    docs: docs("crmactions/list-phone-numbers"),
    method: "GET",
    path: "/crm-actions/phone-numbers",
  },
  dfyAccounts: {
    description:
      "The done-for-you mailboxes the workspace ordered. Passwords are never asked for.",
    docs: docs("dfyemailaccountorder/list-dfy-ordered-email-accounts"),
    method: "GET",
    params: {
      ...PAGE,
    },
    path: "/dfy-email-account-orders/accounts",
  },
  dfyOrders: {
    description: "The done-for-you mailbox orders the workspace placed.",
    docs: docs("dfyemailaccountorder/list-dfy-email-account-order"),
    method: "GET",
    params: {
      ...PAGE,
    },
    path: "/dfy-email-account-orders",
  },
  dfyPreWarmedDomains: {
    description: "The pre-warmed domains Instantly has for sale.",
    docs: docs("dfyemailaccountorder/get-pre-warmed-up-domains"),
    method: "POST",
    params: {
      extensions: inBody("json", "Only these extensions: com, org or co."),
      search: inBody("string", "Part or all of a domain name."),
    },
    path: "/dfy-email-account-orders/domains/pre-warmed-up-list",
  },
  domainForwarding: {
    description:
      "Where a domain bought through Instantly forwards web visitors.",
    docs: docs("domainforwarding/get-domain-forwarding"),
    method: "GET",
    params: {
      domain: inPath("The domain."),
    },
    path: "/domains/{domain}/forwarding",
  },
  inboxPlacementEspOptions: {
    description: "The mail providers an inbox placement test can send to.",
    docs: docs("inboxplacementtest/get-esp-options"),
    method: "GET",
    path: "/inbox-placement-tests/email-service-provider-options",
  },
  inboxPlacementInsights: {
    description:
      "A test's inbox, spam and category shares, with the earlier period beside them when asked.",
    docs: docs(
      "inboxplacementanalytics/retrieve-inbox-placement-analytics-deliverability-insights"
    ),
    method: "POST",
    params: {
      date_from: inBody("string", "First day of the window."),
      date_to: inBody("string", "Last day of the window."),
      previous_date_from: inBody("string", "First day of the earlier window."),
      previous_date_to: inBody("string", "Last day of the earlier window."),
      recipient_esp: inBody(
        "json",
        "Provider codes, for example 1 Google and 2 Microsoft."
      ),
      recipient_geo: inBody(
        "json",
        "Region codes: 1 United States, 2 Italy, 3 Germany, 4 France."
      ),
      recipient_type: inBody(
        "json",
        "Recipient types: 1 professional, 2 personal."
      ),
      show_previous: inBody("boolean", "Add the earlier window's numbers."),
      test_id: inBodyRequired("string", "The test."),
    },
    path: "/inbox-placement-analytics/deliverability-insights",
  },
  inboxPlacementReport: {
    description: "One blacklist and SpamAssassin report.",
    docs: docs(
      "inboxplacementblacklistandspamassassinreport/get-inbox-placement-blacklist-and-spamassassin-report"
    ),
    method: "GET",
    params: {
      id: inPath("The report."),
    },
    path: "/inbox-placement-reports/{id}",
  },
  inboxPlacementReports: {
    description: "A test's blacklist and SpamAssassin reports.",
    docs: docs(
      "inboxplacementblacklistandspamassassinreport/list-inbox-placement-blacklist-and-spamassassin-report"
    ),
    method: "GET",
    params: {
      ...PAGE,
      date_from: inQuery("string", "First day of the window."),
      date_to: inQuery("string", "Last day of the window."),
      skip_blacklist_report: inQuery(
        "boolean",
        "Leave out the blacklist report."
      ),
      skip_spam_assassin_report: inQuery(
        "boolean",
        "Leave out the SpamAssassin report."
      ),
      test_id: inQueryRequired("string", "The test."),
    },
    path: "/inbox-placement-reports",
  },
  inboxPlacementResult: {
    description: "One test email's placement result.",
    docs: docs("inboxplacementanalytics/get-inbox-placement-analytics"),
    method: "GET",
    params: {
      id: inPath("The result."),
    },
    path: "/inbox-placement-analytics/{id}",
  },
  inboxPlacementResults: {
    description:
      "Where each test email landed: inbox, spam or a category folder, with its SPF, DKIM and DMARC results.",
    docs: docs("inboxplacementanalytics/list-inbox-placement-analytics"),
    method: "GET",
    params: {
      ...PAGE,
      date_from: inQuery("string", "First day of the window."),
      date_to: inQuery("string", "Last day of the window."),
      recipient_esp: inQuery("string", "Provider codes, separated by commas."),
      recipient_geo: inQuery("string", "Region codes, separated by commas."),
      recipient_type: inQuery(
        "string",
        "Recipient type codes, separated by commas."
      ),
      sender_email: inQuery("string", "Only this sending mailbox."),
      test_id: inQueryRequired("string", "The test."),
    },
    path: "/inbox-placement-analytics",
  },
  inboxPlacementStatsByDate: {
    description: "A test's inbox, spam and category counts for each day.",
    docs: docs(
      "inboxplacementanalytics/get-inbox-placement-analytics-stats-by-date"
    ),
    method: "POST",
    params: {
      date_from: inBody("string", "First day of the window."),
      date_to: inBody("string", "Last day of the window."),
      recipient_esp: inBody(
        "json",
        "Provider codes, for example 1 Google and 2 Microsoft."
      ),
      recipient_geo: inBody(
        "json",
        "Region codes: 1 United States, 2 Italy, 3 Germany, 4 France."
      ),
      recipient_type: inBody(
        "json",
        "Recipient types: 1 professional, 2 personal."
      ),
      sender_email: inBody("string", "Only this sending mailbox."),
      test_id: inBodyRequired("string", "The test."),
    },
    path: "/inbox-placement-analytics/stats-by-date",
  },
  inboxPlacementStatsByTest: {
    description: "Inbox, spam and category counts for each of several tests.",
    docs: docs(
      "inboxplacementanalytics/retrieve-inbox-placement-analytics-stats-by-test-id"
    ),
    method: "POST",
    params: {
      date_from: inBody("string", "First day of the window."),
      date_to: inBody("string", "Last day of the window."),
      recipient_esp: inBody(
        "json",
        "Provider codes, for example 1 Google and 2 Microsoft."
      ),
      recipient_geo: inBody(
        "json",
        "Region codes: 1 United States, 2 Italy, 3 Germany, 4 France."
      ),
      recipient_type: inBody(
        "json",
        "Recipient types: 1 professional, 2 personal."
      ),
      sender_email: inBody("string", "Only this sending mailbox."),
      test_ids: inBodyRequired("json", "The tests."),
    },
    path: "/inbox-placement-analytics/stats-by-test-id",
  },
  inboxPlacementTest: {
    description: "One inbox placement test.",
    docs: docs("inboxplacementtest/get-inbox-placement-test"),
    method: "GET",
    params: {
      id: inPath("The test."),
      with_metadata: inQuery("boolean", "Add metadata about the test."),
    },
    path: "/inbox-placement-tests/{id}",
  },
  inboxPlacementTests: {
    description: "The workspace's inbox placement tests.",
    docs: docs("inboxplacementtest/list-inbox-placement-test"),
    method: "GET",
    params: {
      ...PAGE,
      search: inQuery("string", "Text to find in a test's name."),
      sort_order: inQuery("string", "asc or desc."),
      status: inQuery("number", "1, 2 or 3, the test's status code."),
    },
    path: "/inbox-placement-tests",
  },
  trackingDomainStatus: {
    description:
      "Whether a custom tracking domain's CNAME and SSL are in place.",
    docs: docs("account/get-custom-tracking-domain-status"),
    method: "GET",
    params: {
      host: inQueryRequired("string", "The tracking domain's host."),
    },
    path: "/accounts/ctd/status",
  },
});
