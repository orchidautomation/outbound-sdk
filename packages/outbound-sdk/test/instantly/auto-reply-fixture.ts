// The anonymized campaign of `listEmails.autoReplies.json` and
// `listLeads.autoReplies.json` (OUT-92), served the way Instantly filters it.

import { fixture } from "../helpers/fixtures.ts";
import type { RecordedRequest } from "../helpers/http.ts";
import { json } from "../helpers/http.ts";

export type Raw = Record<string, unknown>;

export const EMAILS = (
  fixture("instantly", "listEmails.autoReplies.json") as { items: Raw[] }
).items;

const LEADS = (
  fixture("instantly", "listLeads.autoReplies.json") as { items: Raw[] }
).items;

export const MAILBOX = "person51@example.com";
export const HELPDESK = "person52@example.net";
export const PERSON = "person53@example.org";

/** Answers the emails and leads of the fixture, filtered the way Instantly filters them. */
export const autoReplyRoutes =
  (emails: readonly Raw[] = EMAILS) =>
  (request: RecordedRequest): Response | undefined => {
    const url = new URL(request.url);

    if (url.pathname === "/api/v2/emails") {
      const lead = url.searchParams.get("lead");
      const received = url.searchParams.get("email_type") === "received";

      return json({
        items: emails.filter(
          (item) =>
            (!received || item.ue_type === 2) &&
            (lead === null || item.lead === lead)
        ),
      });
    }

    const one = LEADS.find(
      (item) => url.pathname === `/api/v2/leads/${String(item.id)}`
    );

    if (one !== undefined) {
      return json(one);
    }

    if (url.pathname === "/api/v2/leads/list") {
      const body = JSON.parse(request.body ?? "{}") as { contacts?: string[] };
      const contacts = body.contacts?.map((each) => each.toLowerCase());

      return json({
        items: LEADS.filter(
          (item) =>
            contacts === undefined || contacts.includes(String(item.email))
        ),
      });
    }

    return undefined;
  };
