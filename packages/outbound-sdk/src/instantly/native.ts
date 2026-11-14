// Instantly's own reads that have no normalized form, by name. Every read
// endpoint in the API V2 reference is either used by a normalized read or
// listed here; site/content/docs/coverage/instantly.mdx accounts for each one.

import { defineNative } from "../internal/native.ts";
import { SALES_AGENT_READS } from "./native-agents-sales.ts";
import { AGENT_READS } from "./native-agents.ts";
import { CAMPAIGN_READS } from "./native-campaigns.ts";
import { LEAD_READS } from "./native-leads.ts";
import { SEARCH_READS } from "./native-search.ts";
import { SENDER_READS } from "./native-senders.ts";
import { SUPERSEARCH_READS } from "./native-supersearch.ts";
import { WORKSPACE_READS } from "./native-workspace.ts";

export const NATIVE = defineNative({
  ...AGENT_READS,
  ...CAMPAIGN_READS,
  ...LEAD_READS,
  ...SALES_AGENT_READS,
  ...SEARCH_READS,
  ...SENDER_READS,
  ...SUPERSEARCH_READS,
  ...WORKSPACE_READS,
});

export type InstantlyNative = typeof NATIVE;
