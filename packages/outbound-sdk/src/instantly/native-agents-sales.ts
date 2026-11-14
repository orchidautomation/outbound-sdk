// The AI Lead Finder Agents and the AI Sales Agents.
// Each entry is one read Instantly documents; site/content/docs/coverage/instantly.mdx lists them all.

import { defineNative } from "../internal/native.ts";
import {
  docs,
  inBody,
  inBodyRequired,
  inPath,
  inQuery,
  PAGE,
} from "./native-params.ts";

export const SALES_AGENT_READS = defineNative({
  leadFinderActivities: {
    description: "What a Lead Finder Agent did, newest first.",
    docs: docs("aileadfinderagent/list-ai-lead-finder-agent-activities"),
    method: "GET",
    params: {
      ...PAGE,
      id: inPath("The agent."),
    },
    path: "/ai-agents/lead-finder/{id}/activities",
  },
  leadFinderAgent: {
    description: "One Lead Finder Agent with its configuration.",
    docs: docs("aileadfinderagent/get-an-ai-lead-finder-agent"),
    method: "GET",
    params: {
      id: inPath("The agent."),
    },
    path: "/ai-agents/lead-finder/{id}",
  },
  leadFinderAgents: {
    description:
      "The AI Lead Finder Agents that keep campaigns stocked with leads.",
    docs: docs("aileadfinderagent/list-ai-lead-finder-agents"),
    method: "GET",
    params: {
      ...PAGE,
      campaign_id: inQuery("string", "Only the agent stocking this campaign."),
    },
    path: "/ai-agents/lead-finder",
  },
  leadFinderAudienceSuggestions: {
    description:
      "SuperSearch audiences that match the leads already in a campaign. Nothing is saved.",
    docs: docs("aileadfinderagent/suggest-audiences-from-a-campaign"),
    method: "POST",
    params: {
      campaign_id: inBodyRequired(
        "string",
        "The campaign whose leads are analyzed."
      ),
      count: inBody("number", "How many suggestions, 1 to 5."),
    },
    path: "/ai-agents/lead-finder/suggest-audience",
  },
  leadFinderStats: {
    description: "A Lead Finder Agent's lifetime totals.",
    docs: docs("aileadfinderagent/get-ai-lead-finder-agent-lifetime-stats"),
    method: "GET",
    params: {
      id: inPath("The agent."),
    },
    path: "/ai-agents/lead-finder/{id}/stats",
  },
  leadFinderWorkflows: {
    description: "The enrichment workflows saved for Lead Finder Agents.",
    docs: docs("aileadfinderagent/list-saved-enrichment-workflows"),
    method: "GET",
    path: "/ai-agents/lead-finder/enrichment-workflows",
  },
  salesAgent: {
    description: "One AI Sales Agent with its configuration.",
    docs: docs("aisalesagent/get-an-ai-sales-agent"),
    method: "GET",
    params: {
      id: inPath("The agent."),
    },
    path: "/ai-agents/sales/{id}",
  },
  salesAgentActivities: {
    description: "What an AI Sales Agent did or proposes to do.",
    docs: docs("aisalesagent/list-ai-sales-agent-activities"),
    method: "GET",
    params: {
      ...PAGE,
      action_status: inQuery(
        "list",
        "Only these statuses, for example pending."
      ),
      action_type: inQuery(
        "list",
        "Only these action types, for example create_campaign."
      ),
      exclude_live_feed_hidden: inQuery(
        "boolean",
        "Leave out what the live feed hides."
      ),
      id: inPath("The agent."),
      lead_email: inQuery("string", "Only activities for this lead."),
    },
    path: "/ai-agents/sales/{id}/activities",
  },
  salesAgentAnalytics: {
    description:
      "Leads found, emails sent, replies and opportunities per day across an AI Sales Agent's campaigns.",
    docs: docs("aisalesagent/get-ai-sales-agent-analytics"),
    method: "GET",
    params: {
      end_date: inQuery("string", "Last day, YYYY-MM-DD or an ISO 8601 time."),
      id: inPath("The agent."),
      start_date: inQuery(
        "string",
        "First day, YYYY-MM-DD or an ISO 8601 time."
      ),
    },
    path: "/ai-agents/sales/{id}/analytics",
  },
  salesAgentGuidanceRules: {
    description: "The rules an AI Sales Agent follows when it writes.",
    docs: docs("aisalesagent/list-ai-sales-agent-guidance-rules"),
    method: "GET",
    params: {
      id: inPath("The agent."),
    },
    path: "/ai-agents/sales/{id}/guidance-rules",
  },
  salesAgentLeadActivity: {
    description:
      "Each lead's history across an AI Sales Agent's campaigns: sends, opens, replies, clicks, bounces and opportunity status.",
    docs: docs("aisalesagent/list-ai-sales-agent-lead-activity"),
    method: "GET",
    params: {
      ...PAGE,
      end_date: inQuery("string", "Last day, YYYY-MM-DD or an ISO 8601 time."),
      filter: inQuery("string", "replied or has_opportunity."),
      id: inPath("The agent."),
      start_date: inQuery(
        "string",
        "First day, YYYY-MM-DD or an ISO 8601 time."
      ),
    },
    path: "/ai-agents/sales/{id}/leads/activity",
  },
  salesAgentLeadActivitySummary: {
    description:
      "Lead activity counts and rates across an AI Sales Agent's campaigns.",
    docs: docs("aisalesagent/get-ai-sales-agent-lead-activity-summary"),
    method: "GET",
    params: {
      end_date: inQuery("string", "Last day, YYYY-MM-DD or an ISO 8601 time."),
      id: inPath("The agent."),
      start_date: inQuery(
        "string",
        "First day, YYYY-MM-DD or an ISO 8601 time."
      ),
    },
    path: "/ai-agents/sales/{id}/leads/activity/summary",
  },
  salesAgentLeadResearch: {
    description: "The sources an AI Sales Agent used to research one lead.",
    docs: docs("aisalesagent/get-research-sources-for-an-ai-sales-agent-lead"),
    method: "GET",
    params: {
      id: inPath("The agent."),
      lead_id: inPath("The lead."),
    },
    path: "/ai-agents/sales/{id}/leads/{lead_id}/research",
  },
  salesAgentOpportunities: {
    description:
      "Opportunities by status and by campaign for an AI Sales Agent.",
    docs: docs("aisalesagent/get-ai-sales-agent-opportunity-summary"),
    method: "GET",
    params: {
      end_date: inQuery("string", "Last day, YYYY-MM-DD or an ISO 8601 time."),
      id: inPath("The agent."),
      start_date: inQuery(
        "string",
        "First day, YYYY-MM-DD or an ISO 8601 time."
      ),
    },
    path: "/ai-agents/sales/{id}/opportunities/summary",
  },
  salesAgents: {
    description: "The workspace's AI Sales Agents, newest first.",
    docs: docs("aisalesagent/list-ai-sales-agents"),
    method: "GET",
    params: {
      ...PAGE,
      agent_type: inQuery(
        "number",
        "2 sales, 7 recruiting, 8 investment, 9 user research or 10 partnership."
      ),
      search: inQuery("string", "Text to find in the name."),
      status: inQuery("number", "-1 trial expired, 0 inactive or 1 active."),
    },
    path: "/ai-agents/sales",
  },
});
