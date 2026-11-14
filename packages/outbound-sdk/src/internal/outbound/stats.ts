import { requireCapability } from "../capabilities.ts";
import type { CapabilityKey } from "../capabilities.ts";
import { metricRowSchema } from "../entities.ts";
import type { MetricScope } from "../entities.ts";
import { OutboundError } from "../errors.ts";
import type { StatsResult, TopLevelStatsOptions } from "./api.ts";
import { checked, infoFor, metaFor, perform } from "./core.ts";
import type { Core } from "./core.ts";
import { assertDay } from "./validate.ts";

const SCOPE_CAPABILITY = {
  campaign: "stats.campaign",
  sender: "stats.bySender",
  step: "stats.byStep",
  workspace: "stats.workspace",
} as const satisfies Record<MetricScope, CapabilityKey>;

/** Counts for a scope, as totals or one row per day. */
export const readStats = (
  core: Core,
  options: TopLevelStatsOptions = {}
): Promise<StatsResult> => {
  const scope = options.scope ?? "workspace";
  const by = options.by ?? "total";
  const from = assertDay(options.from, "from");
  const to = assertDay(options.to, "to");

  if (from !== undefined && to !== undefined && from > to) {
    throw new OutboundError("Invalid", "from must not be after to");
  }

  if (scope !== "workspace" && options.scopeId === undefined) {
    throw new OutboundError(
      "Invalid",
      `stats for the ${scope} scope need a scopeId`
    );
  }

  requireCapability(
    core.gate,
    SCOPE_CAPABILITY[scope],
    `Stats for the ${scope} scope`
  );

  if (by === "day") {
    requireCapability(core.gate, "stats.byDay", "Stats by day");
  }

  return perform(core, "stats", options, async (state) => {
    const output = await core.run(
      {
        kind: "stats",
        query: { by, from, scope, scopeId: options.scopeId, to },
      },
      infoFor(core, state)
    );

    return {
      meta: metaFor(core, state, {
        complete: true,
        evidence: output.evidence,
        stale: output.stale,
      }),
      rows: checked(core, metricRowSchema, output.items, "stats"),
    };
  });
};
