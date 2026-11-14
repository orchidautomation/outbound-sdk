// The people insights. Each file in this folder defines one; this list is
// what the registry reads.

import { personSummary } from "./person-summary.ts";

export const PEOPLE_INSIGHTS = [personSummary] as const;
