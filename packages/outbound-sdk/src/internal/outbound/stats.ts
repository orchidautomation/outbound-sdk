import { requireCapability } from "../capabilities.ts";
import type { CapabilityKey } from "../capabilities.ts";
import type { CallState } from "../engine/request.ts";
import { metricRowSchema, senderSchema } from "../entities.ts";
import type { MetricScope } from "../entities.ts";
import { OutboundError } from "../errors.ts";
import type { Json } from "../json.ts";
import { plural } from "../numbers.ts";
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

/** Every sender's ref, page by page, counted in the stats call's own requests and budget. */
const everySenderId = async (
  core: Core,
  state: CallState
): Promise<string[]> => {
  const ids = new Set<string>();
  let next: Json | undefined;

  do {
    // oxlint-disable-next-line no-await-in-loop -- each page needs the previous page's continuation.
    const output = await core.run(
      { kind: "senders.list", query: { limit: undefined, next } },
      infoFor(core, state)
    );

    for (const sender of checked(
      core,
      senderSchema,
      output.items,
      "senders.list"
    )) {
      ids.add(sender.ref);
    }

    ({ next } = output);
  } while (next !== undefined);

  return [...ids];
};

/** Rows by day need `stats.byDay`, and a step's need `stats.byStepDay` as well. */
const requireDays = (core: Core, scope: MetricScope): void => {
  requireCapability(core.gate, "stats.byDay", "Reading stats by day");

  if (scope === "step") {
    requireCapability(
      core.gate,
      "stats.byStepDay",
      "Reading a step's stats by day"
    );
  }
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

  // The sender scope with no sender named is a row per sender, read in the
  // batches `scopeIds` reads in.
  const everySender =
    scope === "sender" &&
    options.scopeId === undefined &&
    scopeIds === undefined;

  // Every other scope reads all of its kind without an id; a step does not.
  if (scope === "step" && options.scopeId === undefined) {
    throw new OutboundError(
      "Invalid",
      "stats for the step scope need a scopeId"
    );
  }

  if (everySender) {
    requireCapability(core.gate, "senders.list", "Listing senders");
  }

  requireCapability(
    core.gate,
    everyCampaign ? "stats.allCampaigns" : SCOPE_CAPABILITY[scope],
    everyCampaign
      ? "Reading stats for every campaign in one call"
      : `Reading stats for the ${scope} scope`
  );

  if (scopeIds !== undefined || everySender) {
    requireCapability(
      core.gate,
      "stats.bySenders",
      everySender
        ? "Reading stats for every sender in one call (pass scopeId to read one sender)"
        : "Reading stats for several senders in one call"
    );
  }

  if (by === "day") {
    requireDays(core, scope);
  }

  return await perform(core, "stats", options, async (state) => {
    const senders = everySender ? await everySenderId(core, state) : scopeIds;

    const listed = everySender
      ? [`Read every sender: ${plural(senders?.length ?? 0, "sender")} listed.`]
      : [];

    if (senders !== undefined && senders.length === 0) {
      return {
        meta: metaFor(core, state, {
          complete: true,
          evidence: "exact",
          notes: listed,
        }),
        rows: [],
      };
    }

    const output = await core.run(
      {
        kind: "stats",
        query: {
          by,
          from,
          scope,
          scopeId: options.scopeId,
          scopeIds: senders,
          to,
        },
      },
      infoFor(core, state)
    );

    return {
      meta: metaFor(core, state, {
        complete: true,
        evidence: output.evidence,
        fetchedAt: output.fetchedAt,
        notes: [...listed, ...(output.notes ?? [])],
        stale: output.stale,
      }),
      rows: checked(core, metricRowSchema, output.items, "stats"),
    };
  });
};
