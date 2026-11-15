import type { StatsQuery } from "../internal/adapter.ts";
import type { MetricRow } from "../internal/entities.ts";
import { emptyCounts, sumCounts } from "../internal/metrics.ts";
import type { Identity } from "../internal/record.ts";
import { toMetricRow } from "./data.ts";
import type { MemoryStats } from "./data.ts";

const matchesScope = (row: MemoryStats, query: StatsQuery): boolean => {
  switch (query.scope) {
    case "workspace": {
      return row.senderId === undefined && row.stepIndex === undefined;
    }

    case "campaign": {
      // With no campaign named, every campaign's rows, grouped below.
      return (
        (query.scopeId === undefined || row.campaignId === query.scopeId) &&
        row.senderId === undefined &&
        row.stepIndex === undefined
      );
    }

    case "step": {
      return row.campaignId === query.scopeId && row.stepIndex !== undefined;
    }

    case "sender": {
      return row.senderId === query.scopeId;
    }

    default: {
      const unreachable: never = query.scope;

      return unreachable;
    }
  }
};

const inRange = (row: MemoryStats, query: StatsQuery): boolean =>
  (query.from === undefined || row.date >= query.from) &&
  (query.to === undefined || row.date <= query.to);

const groupKey = (row: MemoryStats, query: StatsQuery): string =>
  [
    query.scope === "campaign" ? row.campaignId : "",
    query.by === "day" ? row.date : "",
    query.scope === "step" ? row.stepIndex : "",
    query.scope === "step" ? (row.variantKey ?? "") : "",
  ].join("|");

/** Aggregates seeded rows the way a vendor's analytics endpoint would. */
export const queryStats = (
  identity: Identity,
  seeds: readonly MemoryStats[],
  query: StatsQuery
): MetricRow[] => {
  const groups = new Map<string, MemoryStats[]>();

  for (const row of seeds) {
    if (matchesScope(row, query) && inRange(row, query)) {
      const key = groupKey(row, query);
      groups.set(key, [...(groups.get(key) ?? []), row]);
    }
  }

  return [...groups.values()]
    .map((rows) => {
      const [first] = rows;

      return toMetricRow(
        {
          ...identity,
          date: query.by === "day" ? (first?.date ?? null) : null,
          scope: query.scope,
          scopeId:
            query.scopeId ??
            (query.scope === "campaign" ? first?.campaignId : undefined) ??
            identity.workspaceId,
          stepIndex: query.scope === "step" ? (first?.stepIndex ?? null) : null,
          variantKey:
            query.scope === "step" ? (first?.variantKey ?? null) : null,
        },
        sumCounts(rows.map((row) => ({ ...emptyCounts(), ...row.counts })))
      );
    })
    .toSorted(
      (left, right) =>
        (left.date ?? "").localeCompare(right.date ?? "") ||
        (left.stepIndex ?? 0) - (right.stepIndex ?? 0) ||
        (left.variantKey ?? "").localeCompare(right.variantKey ?? "")
    );
};
