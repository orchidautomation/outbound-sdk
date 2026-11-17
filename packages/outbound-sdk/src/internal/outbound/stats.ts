import { requireCapability } from "../capabilities.ts";
import type { CapabilityKey } from "../capabilities.ts";
import { metricRowSchema } from "../entities.ts";
import type { MetricScope } from "../entities.ts";
import { OutboundError } from "../errors.ts";
import type { StatsResult, TopLevelStatsOptions } from "./api.ts";
import { checked, infoFor, metaFor, perform } from "./core.ts";
import type { Core } from "./core.ts";
import { assertDay, assertId } from "./validate.ts";

const SCOPE_CAPABILITY = {
  campaign: "stats.campaign",
  sender: "stats.bySender",
  step: "stats.byStep",
  workspace: "stats.workspace",
} as const satisfies Record<MetricScope, CapabilityKey>;

/** The senders of a read of several, checked. */
const sendersOf = (
  options: TopLevelStatsOptions
): readonly string[] | undefined => {
  if (options.scopeIds === undefined) {
    return undefined;
  }

  if (options.scope !== "sender" || options.scopeId !== undefined) {
    throw new OutboundError(
      "Invalid",
      "scopeIds is for the sender scope, in place of scopeId"
    );
  }

  if (options.scopeIds.length === 0) {
    throw new OutboundError("Invalid", "scopeIds needs at least one sender");
  }

  return options.scopeIds.map((id) => assertId(id, "Sender"));
};

/**
 * Counts for a scope, as totals or one row per day. Async, so a refused
 * input or capability rejects like every other failure of the call.
 */
export const readStats = async (
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

  const scopeIds = sendersOf(options);

  // The campaign scope with no campaign named is a row per campaign.
  const everyCampaign = scope === "campaign" && options.scopeId === undefined;

  if (
    scope !== "workspace" &&
    options.scopeId === undefined &&
    scopeIds === undefined &&
    !everyCampaign
  ) {
    throw new OutboundError(
      "Invalid",
      `stats for the ${scope} scope need a scopeId`
    );
  }

  requireCapability(
    core.gate,
    everyCampaign ? "stats.allCampaigns" : SCOPE_CAPABILITY[scope],
    everyCampaign
      ? "Reading stats for every campaign in one call"
      : `Reading stats for the ${scope} scope`
  );

  if (scopeIds !== undefined) {
    requireCapability(
      core.gate,
      "stats.bySenders",
      "Reading stats for several senders in one call"
    );
  }

  if (by === "day") {
    requireCapability(core.gate, "stats.byDay", "Reading stats by day");
  }

  return await perform(core, "stats", options, async (state) => {
    const output = await core.run(
      {
        kind: "stats",
        query: { by, from, scope, scopeId: options.scopeId, scopeIds, to },
      },
      infoFor(core, state)
    );

    return {
      meta: metaFor(core, state, {
        complete: true,
        evidence: output.evidence,
        fetchedAt: output.fetchedAt,
        notes: output.notes,
        stale: output.stale,
      }),
      rows: checked(core, metricRowSchema, output.items, "stats"),
    };
  });
};
