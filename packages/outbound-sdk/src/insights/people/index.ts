// The people insights. Each file in this folder defines one; this list is
// what the registry reads.

import { accountSummary } from "./account-summary.ts";
import { droppedReplies } from "./dropped-replies.ts";
import { hotLeads } from "./hot-leads.ts";
import { leadCollisions } from "./lead-collisions.ts";
import { personSummary } from "./person-summary.ts";
import { personalizationGaps } from "./personalization-gaps.ts";
import { suppressionCheck } from "./suppression-check.ts";

export const PEOPLE_INSIGHTS = [
  personSummary,
  accountSummary,
  leadCollisions,
  suppressionCheck,
  droppedReplies,
  hotLeads,
  personalizationGaps,
] as const;

export type {
  AccountPerson,
  AccountRecord,
  AccountSummary,
} from "./account-summary.ts";

export type { DroppedReply } from "./dropped-replies-check.ts";

export type { DroppedReplies } from "./dropped-replies.ts";

export type { HotLead, HotLeadParts, HotLeads } from "./hot-leads.ts";

export type {
  CollisionCampaign,
  LeadCollision,
  LeadCollisions,
} from "./lead-collisions.ts";

export type { PersonCampaign, PersonSummary } from "./person-summary.ts";

export type {
  CopyVariable,
  GapLead,
  PersonalizationGaps,
  VariableUse,
} from "./personalization-gaps.ts";

export type {
  SuppressionCampaign,
  SuppressionCheck,
  SuppressionMatch,
  SuppressionViolation,
} from "./suppression-check.ts";
