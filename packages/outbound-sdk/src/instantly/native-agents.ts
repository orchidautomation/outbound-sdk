// The AI Deliverability Agent and the AI Inbox Managers.
// Each entry is one read Instantly documents; docs/coverage/instantly.md lists them all.

import { defineNative } from "../internal/native.ts";
import { docs, inPath, inQuery, PAGE } from "./native-params.ts";

export const AGENT_READS = defineNative({
  deliverabilityAgent: {
    description:
      "The workspace's default AI Deliverability Agent, or null when none is deployed.",
    docs: docs("aideliverabilityagent/get-the-default-ai-deliverability-agent"),
    method: "GET",
    path: "/ai-agents/deliverability",
  },
  deliverabilityAgentById: {
    description: "One AI Deliverability Agent.",
    docs: docs("aideliverabilityagent/get-an-ai-deliverability-agent"),
    method: "GET",
    params: {
      id: inPath("The agent."),
    },
    path: "/ai-agents/deliverability/{id}",
  },
  deliverabilityAgentFeed: {
    description:
      "A Deliverability Agent's findings and recommendations, newest first.",
    docs: docs("aideliverabilityagent/list-ai-deliverability-agent-feed-items"),
    method: "GET",
    params: {
      ...PAGE,
      feed_filter: inQuery("string", "all, todo or done."),
      id: inPath("The agent."),
    },
    path: "/ai-agents/deliverability/{id}/feed-items",
  },
  deliverabilityAgentState: {
    description:
      "What the default Deliverability Agent is doing: activity, schedule, last run and feed.",
    docs: docs(
      "aideliverabilityagent/get-the-default-ai-deliverability-agent-state"
    ),
    method: "GET",
    params: {
      ...PAGE,
      feed_filter: inQuery("string", "all, todo or done."),
    },
    path: "/ai-agents/deliverability/state",
  },
  deliverabilityAgentStateById: {
    description:
      "What one Deliverability Agent is doing: activity, schedule, last run and feed.",
    docs: docs("aideliverabilityagent/get-ai-deliverability-agent-state"),
    method: "GET",
    params: {
      ...PAGE,
      feed_filter: inQuery("string", "all, todo or done."),
      id: inPath("The agent."),
    },
    path: "/ai-agents/deliverability/{id}/state",
  },
  inboxManager: {
    description: "One AI Inbox Manager with its configuration.",
    docs: docs("aiinboxmanager/get-an-ai-inbox-manager"),
    method: "GET",
    params: {
      id: inPath("The inbox manager."),
      with_metadata: inQuery("boolean", "Add details about the agent."),
    },
    path: "/ai-agents/inbox-manager/{id}",
  },
  inboxManagerActivity: {
    description:
      "An Inbox Manager's replies, follow-ups and no-show recoveries, newest first.",
    docs: docs("aiinboxmanager/list-ai-inbox-manager-activity"),
    method: "GET",
    params: {
      ...PAGE,
      action_pending: inQuery(
        "boolean",
        "true for to-do items, false for done ones."
      ),
      activity_type: inQuery("string", "reply, followup or recovery."),
      id: inPath("The inbox manager."),
      job_type: inQuery(
        "number",
        "1 reply, 2 follow-up or 3 no-show follow-up."
      ),
    },
    path: "/ai-agents/inbox-manager/{id}/analytics/activity",
  },
  inboxManagerGuidance: {
    description: "One guidance of an Inbox Manager.",
    docs: docs("aiinboxmanager/get-an-ai-inbox-manager-guidance"),
    method: "GET",
    params: {
      guidance_id: inPath("The guidance."),
      id: inPath("The inbox manager."),
    },
    path: "/ai-agents/inbox-manager/{id}/guidances/{guidance_id}",
  },
  inboxManagerGuidances: {
    description: "The guidance an Inbox Manager follows.",
    docs: docs("aiinboxmanager/list-ai-inbox-manager-guidances"),
    method: "GET",
    params: {
      ...PAGE,
      id: inPath("The inbox manager."),
      status: inQuery("number", "1 active or 0 inactive."),
    },
    path: "/ai-agents/inbox-manager/{id}/guidances",
  },
  inboxManagerReplies: {
    description:
      "The replies and follow-ups an Inbox Manager wrote, newest first.",
    docs: docs("aiinboxmanager/list-ai-inbox-manager-replies"),
    method: "GET",
    params: {
      ...PAGE,
      action_pending: inQuery(
        "boolean",
        "Only replies that still need, or no longer need, an action."
      ),
      id: inPath("The inbox manager."),
      information_requested: inQuery(
        "boolean",
        "Only replies where the agent asked for more information, or did not."
      ),
      requires_hitl: inQuery(
        "boolean",
        "Only replies that need, or do not need, a person's review."
      ),
    },
    path: "/ai-agents/inbox-manager/{id}/replies",
  },
  inboxManagerReply: {
    description: "One reply an Inbox Manager wrote, with its HTML body.",
    docs: docs("aiinboxmanager/get-an-ai-inbox-manager-reply"),
    method: "GET",
    params: {
      id: inPath("The inbox manager."),
      reply_id: inPath("The reply."),
    },
    path: "/ai-agents/inbox-manager/{id}/replies/{reply_id}",
  },
  inboxManagerSummary: {
    description: "An Inbox Manager's totals over a window.",
    docs: docs("aiinboxmanager/get-ai-inbox-manager-analytics-summary"),
    method: "GET",
    params: {
      from: inQuery("string", "First day of the window, YYYY-MM-DD."),
      id: inPath("The inbox manager."),
      to: inQuery("string", "Last day of the window, YYYY-MM-DD."),
    },
    path: "/ai-agents/inbox-manager/{id}/analytics/summary",
  },
  inboxManagerSummaryByDate: {
    description: "An Inbox Manager's totals for each day.",
    docs: docs("aiinboxmanager/get-ai-inbox-manager-analytics-by-date"),
    method: "GET",
    params: {
      from: inQuery("string", "First day of the window, YYYY-MM-DD."),
      id: inPath("The inbox manager."),
      to: inQuery("string", "Last day of the window, YYYY-MM-DD."),
    },
    path: "/ai-agents/inbox-manager/{id}/analytics/summary-by-date",
  },
  inboxManagers: {
    description: "The workspace's AI Inbox Managers, newest first.",
    docs: docs("aiinboxmanager/list-ai-inbox-managers"),
    method: "GET",
    params: {
      ...PAGE,
      search: inQuery("string", "Text to find in the name."),
      status: inQuery("number", "0 inactive or 1 active."),
    },
    path: "/ai-agents/inbox-manager",
  },
});
