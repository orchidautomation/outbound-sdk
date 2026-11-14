// What the copy insight tests share: an in-memory tool whose step stats are
// written by hand, for the rows the seed data cannot hold (a row per variant,
// and a row tied to no step).

import assert from "node:assert/strict";

import { createOutbound, makeRef } from "../../src/index.ts";
import type { Adapter, MetricRow } from "../../src/index.ts";
import { insights } from "../../src/insights/index.ts";
import { memory } from "../../src/memory/index.ts";
import type { MemoryData } from "../../src/memory/index.ts";

export const WORKSPACE = "agency";

type Counts = Partial<
  Pick<
    MetricRow,
    | "clicked"
    | "contacted"
    | "delivered"
    | "opened"
    | "positive"
    | "replied"
    | "sent"
  >
>;

export interface StepRow {
  readonly campaignId: string;
  readonly step: number | null;
  readonly variant?: string;
  readonly counts: Counts;
}

const toRow = (provider: string, seed: StepRow): MetricRow => ({
  bounced: null,
  clicked: null,
  clickedTotal: null,
  connectionsAccepted: null,
  connectionsSent: null,
  contacted: null,
  contentHash: null,
  date: null,
  delivered: null,
  evidence: "exact",
  inmailsSent: null,
  opened: null,
  openedTotal: null,
  positive: null,
  provider,
  replied: null,
  repliedAuto: null,
  schemaVersion: 1,
  scope: "step",
  scopeRef: makeRef(provider, WORKSPACE, seed.campaignId),
  sent: null,
  stepIndex: seed.step,
  timezone: null,
  unsubscribed: null,
  variantKey: seed.variant ?? null,
  workspaceId: WORKSPACE,
  ...seed.counts,
});

/** An in-memory tool whose step stats are exactly the given rows. */
export const toolWithRows = (
  data: MemoryData,
  rows: readonly StepRow[],
  name = "memory"
): Adapter => {
  const base = memory({ data, name, workspaceId: WORKSPACE });

  return {
    ...base,
    stats: (query, ctx) =>
      query.scope === "step"
        ? Promise.resolve(
            rows.flatMap((seed) =>
              seed.campaignId === query.scopeId ? [toRow(name, seed)] : []
            )
          )
        : (base.stats?.(query, ctx) ?? Promise.resolve([])),
  };
};

/** An instance over one tool with hand-written step stats. */
export const withRows = (data: MemoryData, rows: readonly StepRow[]) =>
  createOutbound({
    adapter: toolWithRows(data, rows),
    plugins: [insights()],
  });

/** The ref of a campaign in the single in-memory tool. */
export const ref = (id: string, provider = "memory"): string =>
  makeRef(provider, WORKSPACE, id);

/** The value, after asserting it is there, so a test reads its fields plainly. */
export const must = <Value>(value: Value | null | undefined): Value => {
  assert.ok(value !== null && value !== undefined, "expected a value");

  return value;
};
