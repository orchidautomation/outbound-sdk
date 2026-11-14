// Every insight, in the order they are listed to an agent.

import { COPY_INSIGHTS } from "./copy/index.ts";
import type { InsightEntry } from "./define.ts";
import { OPS_INSIGHTS } from "./ops/index.ts";
import { PEOPLE_INSIGHTS } from "./people/index.ts";
import { SENDERS_INSIGHTS } from "./senders/index.ts";

export const INSIGHTS = [
  ...PEOPLE_INSIGHTS,
  ...COPY_INSIGHTS,
  ...SENDERS_INSIGHTS,
  ...OPS_INSIGHTS,
] as const;

export type AnyInsight = (typeof INSIGHTS)[number];

/** The same list with each insight's input and answer types set aside. */
export const ENTRIES: readonly InsightEntry[] = INSIGHTS;
