// Which campaigns a campaign scope covers on one instance, read once per
// run: by id where ids are given, else from a campaign listing the vendor
// filters by tag and name where it can. Nothing per campaign is read before
// this list is known.

import type { Campaign } from "../entities.ts";
import { OutboundError } from "../errors.ts";
import { plural } from "../numbers.ts";
import type { ListAll, OutboundApi, WithMeta } from "../outbound/api.ts";
import { parseRef } from "../ref.ts";
import { admits, describeScope, namesId } from "./rule.ts";
import type { CampaignScope } from "./rule.ts";

/**
 * Who narrowed one tool's campaigns: `id` read by id with no listing,
 * `vendor` the vendor's listing filter alone, `here` a whole listing
 * matched by the scope's rule, `both` the vendor narrowed it and the rest
 * was matched here, `none` not read, as for a tag on a tool without tags.
 */
export type ScopeFilter = "both" | "here" | "id" | "none" | "vendor";

/** How the scope was found on one tool. */
export interface ScopeTool {
  /** `provider:workspaceId`. */
  readonly tool: string;
  readonly campaigns: number;
  readonly filter: ScopeFilter;
}

/** What the scope's own reads are recorded through. */
export interface ScopeReads {
  /** A listing that must be read whole: a cap that stops it fails the run. */
  readonly all: <Item>(walk: ListAll<Item>) => Promise<Item[]>;
  readonly one: <Item>(item: WithMeta<Item>) => Item;
  readonly note: (text: string) => void;
  /** The insight's name, for messages. */
  readonly insight: string;
  /** The run's clock, in milliseconds. */
  readonly now: number;
  /** Told how each tool's campaigns were found. */
  readonly found?: ((tool: ScopeTool) => void) | undefined;
}

const labelOf = (outbound: OutboundApi): string =>
  `${outbound.provider}:${outbound.workspaceId}`;

/** The scope's ids that can be on this instance: its own refs, and bare ids. */
const idsFor = (outbound: OutboundApi, ids: readonly string[]): string[] =>
  ids.filter((id) => {
    const ref = parseRef(id);

    return (
      ref === null ||
      (ref.provider === outbound.provider &&
        ref.workspaceId === outbound.workspaceId)
    );
  });

const byIds = async (
  outbound: OutboundApi,
  ids: readonly string[],
  reads: ScopeReads
): Promise<{ readonly found: Campaign[]; readonly missing: string[] }> => {
  const wanted = idsFor(outbound, ids);

  if (wanted.length === 0) {
    return { found: [], missing: [] };
  }

  const bulk = await outbound.campaigns.getMany(wanted);
  const failed = bulk.errors.find(({ error }) => error.code !== "NotFound");

  if (failed !== undefined) {
    throw failed.error;
  }

  // Every value carries the requests of the whole call so far, so only the
  // one that carries the most is counted.
  let last: WithMeta<Campaign> | undefined;

  for (const { value } of bulk.results) {
    if (last === undefined || value.meta.requests > last.meta.requests) {
      last = value;
    }
  }

  return {
    found: bulk.results.map(({ value }) =>
      value === last ? reads.one(value) : value
    ),
    missing: bulk.errors.map(({ id }) => id),
  };
};

/** How a listing was narrowed, and the note that says so. */
interface Listed {
  readonly filter: ScopeFilter;
  readonly text: string;
}

const howListed = (outbound: OutboundApi, scope: CampaignScope): Listed => {
  const { capabilities } = outbound;

  const vendor = [
    scope.tag !== undefined && capabilities["campaigns.byTag"] === "server"
      ? "tag"
      : undefined,
    scope.name?.hint !== undefined &&
    capabilities["campaigns.byName"] === "server"
      ? "name"
      : undefined,
  ].filter((part) => part !== undefined);

  if (vendor.length === 0) {
    return {
      filter: "here",
      text: "The vendor cannot filter its campaign listing by this scope, so the listing was read and filtered here, before any per-campaign read.",
    };
  }

  const whole =
    (scope.tag === undefined || vendor.includes("tag")) &&
    (scope.name === undefined ||
      (vendor.includes("name") && scope.name.kind === "exact"));

  return whole
    ? {
        filter: "vendor",
        text: `The vendor filtered its campaign listing by ${vendor.join(" and ")}, so other campaigns were not listed.`,
      }
    : {
        filter: "both",
        text: `The vendor narrowed its campaign listing by ${vendor.join(" and ")}; the rest of the scope was matched here, before any per-campaign read.`,
      };
};

/** The campaigns of one tool (not a combined instance) the scope covers. */
const oneTool = async (
  outbound: OutboundApi,
  scope: CampaignScope,
  reads: ScopeReads,
  member = false
): Promise<Campaign[]> => {
  const label = labelOf(outbound);
  const words = describeScope(scope);

  if (
    scope.tag !== undefined &&
    outbound.capabilities["campaigns.byTag"] === false
  ) {
    reads.note(
      `${label} was not read: its campaigns carry no tags, so the campaign scope (${words}) covers none of them.`
    );
    reads.found?.({ campaigns: 0, filter: "none", tool: label });

    return [];
  }

  if (scope.ids !== undefined) {
    const { found, missing } = await byIds(outbound, scope.ids, reads);
    const kept = found.filter((campaign) => admits(scope, campaign));

    reads.note(
      `Campaign scope (${words}): ${plural(kept.length, "campaign")} of ${label} match, read by id with no campaign listing.`
    );
    reads.found?.({ campaigns: kept.length, filter: "id", tool: label });

    // On a combined instance a bare id is asked of every tool, so the ids
    // found on none are named once, after all of them.
    if (missing.length > 0 && !member) {
      reads.note(
        `No campaign has the id ${missing.join(", ")}, so the scope leaves ${missing.length === 1 ? "it" : "them"} out.`
      );
    }

    return kept;
  }

  // Only what the vendor filters is sent. What it cannot is matched below by
  // the scope's fixed rule, over a listing read whole, which keeps it exact.
  const { capabilities } = outbound;

  const listed = await reads.all(
    outbound.campaigns.listAll({
      name:
        capabilities["campaigns.byName"] === "server"
          ? scope.name?.hint
          : undefined,
      tag: capabilities["campaigns.byTag"] === "server" ? scope.tag : undefined,
    })
  );

  const kept = listed.filter((campaign) => admits(scope, campaign));

  const how = howListed(outbound, scope);

  reads.note(
    `Campaign scope (${words}): ${plural(kept.length, "campaign")} of ${label} match. ${how.text}`
  );
  reads.found?.({ campaigns: kept.length, filter: how.filter, tool: label });

  return kept;
};

/**
 * The campaigns the scope covers, every state, on this instance: each tool
 * of a combined instance read on its own. Ids found on no tool are named.
 */
export const scopeCampaigns = async (
  outbound: OutboundApi,
  scope: CampaignScope,
  reads: ScopeReads
): Promise<Campaign[]> => {
  if (outbound.provider !== "combined") {
    return await oneTool(outbound, scope, reads);
  }

  const tools = await reads.all(outbound.workspaces.listAll());
  const found: Campaign[] = [];

  for (const tool of tools) {
    // oxlint-disable-next-line no-await-in-loop -- one tool after another, so the notes keep their order
    const each = await oneTool(
      outbound.workspace(`${tool.provider}:${tool.workspaceId}`),
      scope,
      reads,
      true
    );

    found.push(...each);
  }

  const missing = (scope.ids ?? []).filter((id) => {
    const only = { ...scope, ids: [id] };

    return !found.some(
      (campaign) =>
        namesId(only, campaign.ref) || namesId(only, campaign.sourceId)
    );
  });

  if (missing.length > 0) {
    reads.note(
      `No campaign in the scope has the id ${missing.join(", ")}: it is on no tool here, or another part of the scope leaves it out.`
    );
  }

  return found;
};

/** Refuses a tag where no tool's campaigns carry tags, before any request. */
export const refuseTagless = async (
  outbound: OutboundApi,
  name: string,
  scope: CampaignScope | null
): Promise<void> => {
  if (scope?.tag === undefined) {
    return;
  }

  const listed =
    outbound.provider === "combined" ? await outbound.workspaces.list() : null;

  const tools =
    listed === null
      ? [outbound]
      : listed.items.map((tool) =>
          outbound.workspace(`${tool.provider}:${tool.workspaceId}`)
        );

  if (tools.every((tool) => tool.capabilities["campaigns.byTag"] === false)) {
    throw new OutboundError(
      "Unsupported",
      `${name}: the ${outbound.provider} adapter's campaigns carry no tags, so the campaign scope cannot use tag. Use campaign_name or campaign_ids`,
      { provider: outbound.provider }
    );
  }
};
