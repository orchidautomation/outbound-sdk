// The workspace itself: audit log, background jobs, webhook deliveries and members.
// Each entry is one read Instantly documents; site/content/docs/coverage/instantly.mdx lists them all.

import { defineNative, inPath, inQuery } from "../internal/native.ts";
import { docs, PAGE } from "./native-params.ts";

export const WORKSPACE_READS = defineNative({
  agentItems: {
    description: "Every AI agent and automation in the workspace, in one list.",
    docs: docs("engageitem/list-ai-agent-items"),
    method: "GET",
    params: {
      ...PAGE,
      ai_agent_type: inQuery(
        "number",
        "Only this kind of AI agent, by its number."
      ),
      search: inQuery("string", "Text to find in the name."),
      status: inQuery(
        "string",
        "Active, Paused, Draft or Error, separated by commas."
      ),
      type: inQuery(
        "string",
        "ai_agent, automation or both, separated by commas."
      ),
    },
    path: "/agent-items",
  },
  auditLogs: {
    description: "Who did what in the workspace.",
    docs: docs("auditlog/list-audit-log"),
    method: "GET",
    params: {
      ...PAGE,
      activity_type: inQuery(
        "number",
        "Only this activity type, by its number."
      ),
      end_date: inQuery("string", "Only logs up to this day."),
      search: inQuery("string", "Text to find in a log."),
      start_date: inQuery("string", "Only logs from this day on."),
    },
    path: "/audit-logs",
  },
  backgroundJob: {
    description: "One background job and its progress.",
    docs: docs("backgroundjob/get-background-job"),
    method: "GET",
    params: {
      data_fields: inQuery(
        "string",
        "Fields of the job's data to return, separated by commas."
      ),
      id: inPath("The job."),
    },
    path: "/background-jobs/{id}",
  },
  backgroundJobs: {
    description:
      "Background jobs such as lead moves, imports and exports, with their progress.",
    docs: docs("backgroundjob/list-background-job"),
    method: "GET",
    params: {
      ...PAGE,
      entity_id: inQuery(
        "string",
        "Lists or campaigns the job works on, separated by commas."
      ),
      entity_type: inQuery(
        "string",
        "What the job works on, for example list or campaign."
      ),
      excluded_ids: inQuery(
        "string",
        "Jobs to leave out, separated by commas."
      ),
      ids: inQuery("string", "Only these jobs, separated by commas."),
      included_ids: inQuery(
        "string",
        "Jobs to add to the answer, separated by commas."
      ),
      sort_column: inQuery("string", "created_at or updated_at."),
      sort_order: inQuery("string", "asc or desc."),
      status: inQuery(
        "string",
        "pending, in-progress, success or failed, separated by commas."
      ),
      type: inQuery("string", "The kind of job, for example move-leads."),
    },
    path: "/background-jobs",
  },
  webhook: {
    description: "One webhook. Its headers can carry a secret.",
    docs: docs("webhook/get-webhook"),
    method: "GET",
    params: {
      id: inPath("The webhook."),
    },
    path: "/webhooks/{id}",
    sensitive: true,
  },
  webhookEvent: {
    description: "One webhook delivery with its payload and response.",
    docs: docs("webhookevent/get-webhook-event"),
    method: "GET",
    params: {
      id: inPath("The delivery."),
    },
    path: "/webhook-events/{id}",
  },
  webhookEventSummary: {
    description: "How many webhook deliveries worked and failed.",
    docs: docs("webhookevent/get-overview-aggregates-for-webhook-events"),
    method: "GET",
    params: {
      from: inQuery("string", "First day of the window, YYYY-MM-DD."),
      to: inQuery("string", "Last day of the window, YYYY-MM-DD."),
    },
    path: "/webhook-events/summary",
  },
  webhookEventSummaryByDate: {
    description: "Webhook deliveries that worked and failed, for each day.",
    docs: docs(
      "webhookevent/get-overview-aggregates-for-webhook-events-by-date"
    ),
    method: "GET",
    params: {
      from: inQuery("string", "First day of the window, YYYY-MM-DD."),
      to: inQuery("string", "Last day of the window, YYYY-MM-DD."),
    },
    path: "/webhook-events/summary-by-date",
  },
  webhookEventTypes: {
    description:
      "Every event a webhook can listen for, custom lead labels included.",
    docs: docs("webhook/list-available-event-types"),
    method: "GET",
    path: "/webhooks/event-types",
  },
  webhookEvents: {
    description:
      "The delivery log: each webhook call Instantly made and how the receiver answered.",
    docs: docs("webhookevent/list-webhook-event"),
    method: "GET",
    params: {
      ...PAGE,
      from: inQuery("string", "First day of the window, YYYY-MM-DD."),
      search: inQuery("string", "An exact webhook URL or lead email."),
      success: inQuery(
        "boolean",
        "Only deliveries that worked, or only those that failed."
      ),
      to: inQuery("string", "Last day of the window, YYYY-MM-DD."),
    },
    path: "/webhook-events",
  },
  whitelabelDomain: {
    description: "The agency domain verified for the workspace.",
    docs: docs("workspace/get-organization-verified-agency-domain-information"),
    method: "GET",
    path: "/workspaces/current/whitelabel-domain",
  },
  workspaceGroupAdmin: {
    description: "The admin workspace this workspace belongs to.",
    docs: docs(
      "workspacegroupmember/get-the-current-workspace-admin-workspace"
    ),
    method: "GET",
    path: "/workspace-group-members/admin",
  },
  workspaceGroupMember: {
    description: "One sub workspace of an admin workspace.",
    docs: docs("workspacegroupmember/get-workspace-group-member"),
    method: "GET",
    params: {
      id: inPath("The group member."),
    },
    path: "/workspace-group-members/{id}",
  },
  workspaceGroupMembers: {
    description: "The sub workspaces of an agency's admin workspace.",
    docs: docs("workspacegroupmember/list-workspace-group-member"),
    method: "GET",
    params: {
      ...PAGE,
    },
    path: "/workspace-group-members",
  },
  workspaceMember: {
    description: "One workspace member.",
    docs: docs("workspacemember/get-workspace-member"),
    method: "GET",
    params: {
      id: inPath("The member."),
    },
    path: "/workspace-members/{id}",
  },
  workspaceMembers: {
    description:
      "The people in the workspace and their roles. Leads and emails name them in assigned_to.",
    docs: docs("workspacemember/list-workspace-member"),
    method: "GET",
    params: {
      ...PAGE,
      accepted: inQuery(
        "boolean",
        "Only members who accepted, or only those still invited."
      ),
      search: inQuery("string", "A name or an email."),
    },
    path: "/workspace-members",
  },
});
