// EmailBison's own reads about the workspace: the key's user, block list
// entries, variables, events, inbox settings, templates, tags, tracking
// domains and webhook deliveries.

import {
  defineNative,
  inPath,
  inQuery,
  inQueryRequired,
} from "../internal/native.ts";
import { docs, page } from "./native-params.ts";

export const WORKSPACE_NATIVE = defineNative({
  account: {
    description:
      "The user the key belongs to and the workspace it is scoped to.",
    docs: docs("account-management", "get", "/api/users"),
    method: "GET",
    path: "/api/users",
  },
  blacklistedDomain: {
    description: "One blocked domain, by its id.",
    docs: docs(
      "domain-blacklist",
      "get",
      "/api/blacklisted-domains/{blacklisted_domain_id}"
    ),
    method: "GET",
    params: { blacklisted_domain_id: inPath("The entry's id.") },
    path: "/api/blacklisted-domains/{blacklisted_domain_id}",
  },
  blacklistedEmail: {
    description: "One blocked address, by its id.",
    docs: docs(
      "email-blacklist",
      "get",
      "/api/blacklisted-emails/{blacklisted_email_id}"
    ),
    method: "GET",
    params: { blacklisted_email_id: inPath("The entry's id.") },
    path: "/api/blacklisted-emails/{blacklisted_email_id}",
  },
  customVariables: {
    description: "The custom lead variables the workspace has defined.",
    docs: docs("custom-lead-variables", "get", "/api/custom-variables"),
    method: "GET",
    path: "/api/custom-variables",
  },
  event: {
    description:
      "One workspace event with its payload and webhook deliveries. Deliveries name the webhook URL, which can hold a secret.",
    docs: docs("events", "get", "/api/events/{id}"),
    method: "GET",
    params: { id: inPath("The event's id.") },
    path: "/api/events/{id}",
    sensitive: true,
  },
  events: {
    description:
      "The workspace's events of the last 10 days, each with its webhook payload and deliveries. Pages by cursor only.",
    docs: docs("events", "get", "/api/events"),
    method: "GET",
    params: {
      cursor: inQuery("string", "meta.next_cursor of the previous page."),
      end_date: inQuery("string", "Only events before this day."),
      start_date: inQuery("string", "Only events after this day."),
      type: inQuery(
        "string",
        "Only events of this type, such as lead_replied."
      ),
    },
    path: "/api/events",
    sensitive: true,
  },
  ignorePhrase: {
    description: "One phrase that keeps matching emails out of the inbox.",
    docs: docs(
      "ignore-phrases",
      "get",
      "/api/ignore-phrases/{ignore_phrase_id}"
    ),
    method: "GET",
    params: { ignore_phrase_id: inPath("The phrase's id.") },
    path: "/api/ignore-phrases/{ignore_phrase_id}",
  },
  ignorePhrases: {
    description:
      "The phrases that keep matching emails, such as other tools' warmup mail, out of the inbox.",
    docs: docs("ignore-phrases", "get", "/api/ignore-phrases"),
    method: "GET",
    path: "/api/ignore-phrases",
  },
  masterInboxSettings: {
    description:
      "Whether the inbox syncs every email, filters warmup mail and marks interested replies automatically.",
    docs: docs(
      "workspaces-v11",
      "get",
      "/api/workspaces/v1.1/master-inbox-settings"
    ),
    method: "GET",
    path: "/api/workspaces/v1.1/master-inbox-settings",
  },
  oauthSession: {
    description:
      "The state of a Google or Microsoft sign-in session for connecting a sender. Holds the sign-in link.",
    docs: docs("oauth-sessions-beta", "get", "/api/oauth-sessions/{id}"),
    method: "GET",
    params: { id: inPath("The session's id.") },
    path: "/api/oauth-sessions/{id}",
    sensitive: true,
  },
  replyTemplate: {
    description: "One saved reply template.",
    docs: docs("reply-templates", "get", "/api/reply-templates/{id}"),
    method: "GET",
    params: { id: inPath("The template's id.") },
    path: "/api/reply-templates/{id}",
  },
  replyTemplates: {
    description: "The workspace's saved reply templates.",
    docs: docs("reply-templates", "get", "/api/reply-templates"),
    method: "GET",
    params: { ...page, search: inQuery("string", "Text to search for.") },
    path: "/api/reply-templates",
  },
  tag: {
    description: "One tag, by its id.",
    docs: docs("custom-tags", "get", "/api/tags/{id}"),
    method: "GET",
    params: { id: inPath("The tag's id.") },
    path: "/api/tags/{id}",
  },
  trackingDomain: {
    description: "One custom tracking domain and its state.",
    docs: docs(
      "custom-tracking-domains",
      "get",
      "/api/custom-tracking-domain/{id}"
    ),
    method: "GET",
    params: { id: inPath("The domain's id.") },
    path: "/api/custom-tracking-domain/{id}",
  },
  trackingDomains: {
    description:
      "The custom tracking domains for opens and clicks, and their state.",
    docs: docs("custom-tracking-domains", "get", "/api/custom-tracking-domain"),
    method: "GET",
    params: page,
    path: "/api/custom-tracking-domain",
  },
  webhookAttempt: {
    description:
      "One attempt to deliver a webhook: the URL, the response code and the event. The URL can hold a secret.",
    docs: docs("webhook-attempts", "get", "/api/webhook-attempts/{id}"),
    method: "GET",
    params: { id: inPath("The attempt's id.") },
    path: "/api/webhook-attempts/{id}",
    sensitive: true,
  },
  webhookDelivery: {
    description:
      "One webhook delivery and its attempts. The URL can hold a secret.",
    docs: docs("webhook-deliveries", "get", "/api/webhook-deliveries/{id}"),
    method: "GET",
    params: { id: inPath("The delivery's id.") },
    path: "/api/webhook-deliveries/{id}",
    sensitive: true,
  },
  webhookEventTypes: {
    description: "The webhook event types, with the id each is subscribed by.",
    docs: docs("webhook-events", "get", "/api/webhook-events/event-types"),
    method: "GET",
    path: "/api/webhook-events/event-types",
  },
  webhookSamplePayload: {
    description: "A sample webhook payload for one event type.",
    docs: docs("webhook-events", "get", "/api/webhook-events/sample-payload"),
    method: "GET",
    params: {
      event_type: inQueryRequired(
        "string",
        "The event type, such as email_sent."
      ),
    },
    path: "/api/webhook-events/sample-payload",
  },
});
