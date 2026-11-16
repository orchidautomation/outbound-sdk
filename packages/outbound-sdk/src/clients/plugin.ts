// outbound-sdk/clients: which key, workspace or campaign belongs to which
// client. A key and a client do not always match one-to-one: one key can
// cover several clients as campaigns, and one client can span several keys.
//
// By default one workspace is one client. With rules, the first rule that
// matches decides; anything matching no rule is `unassigned`, never placed
// in a client by guesswork.

import { mapConcurrent } from "../internal/concurrency.ts";
import type { OperationOptions } from "../internal/engine/engine.ts";
import type { Campaign } from "../internal/entities.ts";
import { emptyCounts, sumMeasured } from "../internal/metrics.ts";
import type { MetricCounts } from "../internal/metrics.ts";
import type { OutboundApi } from "../internal/outbound/api.ts";
import type { OutboundRecord } from "../internal/outbound/operations.ts";
import type {
  NextOperation,
  OutboundPlugin,
} from "../internal/outbound/plugins.ts";
import { parseRef } from "../internal/ref.ts";

export const UNASSIGNED = "unassigned";

export interface ClientRule {
  /** The client this rule assigns to. */
  readonly client: string;
  readonly provider?: string | undefined;
  readonly workspaceId?: string | undefined;
  /** Campaigns carrying this tag. */
  readonly campaignTag?: string | undefined;
  /** Campaigns by ref or by the vendor's own id. */
  readonly campaignIds?: readonly string[] | undefined;
  /** Campaigns whose name matches. The `g` and `y` flags make no difference. */
  readonly campaignName?: RegExp | undefined;
}

export interface ClientsOptions {
  readonly rules?: readonly ClientRule[] | undefined;
}

export interface ClientStats {
  readonly client: string;
  /** How many campaigns were added together. */
  readonly campaigns: number;
  readonly counts: MetricCounts;
}

export interface ClientStatsOptions extends OperationOptions {
  readonly from?: string | undefined;
  readonly to?: string | undefined;
}

export interface ClientsExtension {
  readonly clients: {
    /** Every client named by a rule, in rule order. */
    readonly names: () => string[];
    /**
     * The same counts for every client, built by adding up each client's
     * campaigns. It costs one stats request per campaign.
     */
    readonly stats: (options?: ClientStatsOptions) => Promise<ClientStats[]>;
    /** `stats()` with the vendor requests it made, listing included. */
    readonly read: (options?: ClientStatsOptions) => Promise<ClientStatsRead>;
  };
}

export interface ClientStatsRead {
  readonly clients: ClientStats[];
  /** Vendor requests made: the campaign listing and each campaign's stats. */
  readonly requests: number;
}

interface CampaignFacts {
  readonly ref: string;
  readonly name: string;
  readonly tags: readonly string[];
}

const isCampaign = (record: OutboundRecord): record is Campaign =>
  "tags" in record && "channel" in record;

const campaignRefOf = (record: OutboundRecord): string | null => {
  if (isCampaign(record)) {
    return record.ref;
  }

  if ("campaignRef" in record) {
    return record.campaignRef;
  }

  return "scope" in record &&
    record.scope !== "workspace" &&
    record.scope !== "sender"
    ? record.scopeRef
    : null;
};

const needsCampaign = (rule: ClientRule): boolean =>
  rule.campaignTag !== undefined || rule.campaignName !== undefined;

const namesCampaign = (
  ids: readonly string[],
  campaign: CampaignFacts
): boolean =>
  ids.includes(campaign.ref) ||
  ids.includes(parseRef(campaign.ref)?.sourceId ?? campaign.ref);

// `test` on a `g` or `y` regex starts at the `lastIndex` the last match left,
// so one rule would match a campaign and miss the next.
const withoutState = (rule: ClientRule): ClientRule =>
  rule.campaignName === undefined
    ? rule
    : {
        ...rule,
        campaignName: new RegExp(
          rule.campaignName.source,
          rule.campaignName.flags.replaceAll(/[gy]/gu, "")
        ),
      };

const matches = (
  rule: ClientRule,
  record: OutboundRecord,
  campaign: CampaignFacts | null
): boolean =>
  (rule.provider === undefined || rule.provider === record.provider) &&
  (rule.workspaceId === undefined || rule.workspaceId === record.workspaceId) &&
  (rule.campaignIds === undefined ||
    (campaign !== null && namesCampaign(rule.campaignIds, campaign))) &&
  (rule.campaignTag === undefined ||
    (campaign !== null && campaign.tags.includes(rule.campaignTag))) &&
  (rule.campaignName === undefined ||
    (campaign !== null && rule.campaignName.test(campaign.name)));

class Assigner {
  readonly #rules: readonly ClientRule[];
  /** Campaigns seen so far, so a lead can be matched by its campaign's tag. */
  readonly #campaigns = new Map<string, CampaignFacts>();

  constructor(rules: readonly ClientRule[]) {
    this.#rules = rules.map(withoutState);
  }

  names(): string[] {
    return [...new Set(this.#rules.map((rule) => rule.client))];
  }

  remember(record: OutboundRecord): void {
    if (isCampaign(record)) {
      this.#campaigns.set(record.ref, {
        name: record.name,
        ref: record.ref,
        tags: record.tags,
      });
    }
  }

  async #campaignFor(
    record: OutboundRecord,
    next: NextOperation
  ): Promise<CampaignFacts | null> {
    const ref = campaignRefOf(record);

    if (ref === null) {
      return null;
    }

    const known = this.#campaigns.get(ref);

    if (known !== undefined || !this.#rules.some(needsCampaign)) {
      return known ?? { name: "", ref, tags: [] };
    }

    // A tag or name rule needs the campaign itself. It is fetched once.
    const output = await next({ id: ref, kind: "campaigns.get" });

    for (const item of output.items) {
      this.remember(item);
    }

    return this.#campaigns.get(ref) ?? { name: "", ref, tags: [] };
  }

  async assign(record: OutboundRecord, next: NextOperation): Promise<string> {
    if (this.#rules.length === 0) {
      // One workspace is one client.
      return record.workspaceId;
    }

    const campaign = await this.#campaignFor(record, next);

    return (
      this.#rules.find((rule) => matches(rule, record, campaign))?.client ??
      UNASSIGNED
    );
  }
}

const clientStats = async (
  outbound: OutboundApi,
  options: ClientStatsOptions
): Promise<ClientStatsRead> => {
  // `from` and `to` are for the stats reads, not the campaign listing.
  const { deadline, maxRequests, retries, signal, timeout } = options;

  const walk = outbound.campaigns.listAll({
    deadline,
    maxRequests,
    retries,
    signal,
    timeout,
  });

  const campaigns = await walk.toArray();
  const byClient = new Map<string, MetricCounts[]>();
  let requests = walk.meta?.requests ?? 0;

  const read = await mapConcurrent(campaigns, async (campaign) => ({
    campaign,
    stats: await outbound.campaign(campaign.ref).stats(options),
  }));

  for (const { campaign, stats } of read) {
    // SAFETY: this plugin's wrap adds `client` to every record, campaigns included.
    const { client } = campaign as typeof campaign & {
      readonly client: string;
    };

    requests += stats.meta.requests;
    byClient.set(client, [...(byClient.get(client) ?? []), ...stats.rows]);
  }

  const clientsRead = [...byClient.entries()]
    .map(([client, rows]) => ({
      campaigns: rows.length,
      client,
      counts: rows.length === 0 ? emptyCounts() : sumMeasured(rows),
    }))
    .toSorted((left, right) => left.client.localeCompare(right.client));

  return { clients: clientsRead, requests };
};

/** Tags every record with the client it belongs to. */
export const clients = (
  options: ClientsOptions = {}
): OutboundPlugin<ClientsExtension> => {
  const assigner = new Assigner(options.rules ?? []);

  return {
    extend: (outbound) => ({
      clients: {
        names: () => assigner.names(),
        read: (statsOptions = {}) => clientStats(outbound, statsOptions),
        stats: async (statsOptions = {}) => {
          const read = await clientStats(outbound, statsOptions);

          return read.clients;
        },
      },
    }),
    name: "clients",
    wrap: async (operation, next) => {
      const output = await next(operation);

      for (const item of output.items) {
        assigner.remember(item);
      }

      const items: OutboundRecord[] = [];

      for (const item of output.items) {
        // oxlint-disable-next-line no-await-in-loop -- a campaign lookup is memoised, so later records reuse it.
        const client = await assigner.assign(item, next);

        const tagged: OutboundRecord & { readonly client: string } = {
          ...item,
          client,
        };

        items.push(tagged);
      }

      return { ...output, items };
    },
  };
};
