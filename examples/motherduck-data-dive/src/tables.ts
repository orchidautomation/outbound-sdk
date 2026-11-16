// The warehouse tables: each one a DuckDB column list and a way to turn
// outbound-sdk records into its rows. Leads keep no name, email or phone:
// the report needs outcomes, not people.

import { OutboundError } from "outbound-sdk";

import type { Source } from "./sources.ts";

type Row = Record<string, boolean | number | string | readonly string[] | null>;

export interface Table {
  readonly name: string;
  /** DuckDB column name to type, as `read_json` takes them. */
  readonly columns: Readonly<Record<string, string>>;
  readonly rows: (source: Source, range: Range) => AsyncIterable<Row>;
}

export interface Range {
  readonly from: string;
  readonly to: string;
}

const identity = (record: {
  provider: string;
  workspaceId: string;
  ref: string;
}) => ({
  provider: record.provider,
  ref: record.ref,
  workspace_id: record.workspaceId,
});

const IDENTITY = {
  provider: "VARCHAR",
  workspace_id: "VARCHAR",
  ref: "VARCHAR",
};

const METRICS = {
  sent: "BIGINT",
  delivered: "BIGINT",
  contacted: "BIGINT",
  opened: "BIGINT",
  clicked: "BIGINT",
  replied: "BIGINT",
  replied_auto: "BIGINT",
  positive: "BIGINT",
  bounced: "BIGINT",
  unsubscribed: "BIGINT",
  connections_sent: "BIGINT",
  connections_accepted: "BIGINT",
};

/**
 * One row per scope per day, from a stats call the tool may not offer.
 *
 * @yields {Row} A `daily_metrics` row.
 */
const metricRows = async function* metricRows(
  read: () => ReturnType<Source["stats"]>,
  label: string
): AsyncIterable<Row> {
  let result: Awaited<ReturnType<Source["stats"]>>;

  try {
    result = await read();
  } catch (error) {
    if (error instanceof OutboundError && error.code === "Unsupported") {
      console.warn(`  skipped ${label}: the tool does not report it`);

      return;
    }

    throw error;
  }

  for (const row of result.rows) {
    yield {
      bounced: row.bounced,
      clicked: row.clicked,
      connections_accepted: row.connectionsAccepted,
      connections_sent: row.connectionsSent,
      contacted: row.contacted,
      date: row.date,
      delivered: row.delivered,
      evidence: row.evidence,
      opened: row.opened,
      positive: row.positive,
      provider: row.provider,
      replied: row.replied,
      replied_auto: row.repliedAuto,
      scope: row.scope,
      scope_ref: row.scopeRef,
      sent: row.sent,
      unsubscribed: row.unsubscribed,
      workspace_id: row.workspaceId,
    };
  }
};

export const TABLES: readonly Table[] = [
  {
    columns: {
      ...IDENTITY,
      name: "VARCHAR",
      channel: "VARCHAR",
      status: "VARCHAR",
      created_at: "TIMESTAMPTZ",
      tags: "VARCHAR[]",
    },
    name: "campaigns",
    async *rows(source) {
      for await (const campaign of source.campaigns.listAll()) {
        yield {
          ...identity(campaign),
          channel: campaign.channel,
          created_at: campaign.createdAt,
          name: campaign.name,
          status: campaign.status,
          tags: campaign.tags,
        };
      }
    },
  },
  {
    columns: {
      ...IDENTITY,
      name: "VARCHAR",
      kind: "VARCHAR",
      address: "VARCHAR",
      mail_provider: "VARCHAR",
      status: "VARCHAR",
      daily_limit: "BIGINT",
      warmup_enabled: "BOOLEAN",
      warmup_score: "DOUBLE",
    },
    name: "senders",
    async *rows(source) {
      for await (const sender of source.senders.listAll()) {
        yield {
          ...identity(sender),
          address: sender.address,
          daily_limit: sender.dailyLimit,
          kind: sender.kind,
          mail_provider: sender.mailProvider,
          name: sender.name,
          status: sender.status,
          warmup_enabled: sender.warmup?.enabled ?? null,
          warmup_score: sender.warmup?.score ?? null,
        };
      }
    },
  },
  {
    columns: {
      ...IDENTITY,
      campaign_ref: "VARCHAR",
      status: "VARCHAR",
      progress: "VARCHAR",
      replied: "BOOLEAN",
      bounced: "BOOLEAN",
      unsubscribed: "BOOLEAN",
      company: "VARCHAR",
      created_at: "TIMESTAMPTZ",
      last_contacted_at: "TIMESTAMPTZ",
      last_replied_at: "TIMESTAMPTZ",
    },
    name: "leads",
    async *rows(source) {
      for await (const lead of source.leads.listAll()) {
        yield {
          ...identity(lead),
          bounced: lead.bounced,
          campaign_ref: lead.campaignRef,
          company: lead.company,
          created_at: lead.createdAt,
          last_contacted_at: lead.engagement?.lastContactedAt ?? null,
          last_replied_at: lead.engagement?.lastRepliedAt ?? null,
          progress: lead.progress,
          replied: lead.replied,
          status: lead.status,
          unsubscribed: lead.unsubscribed,
        };
      }
    },
  },
  {
    columns: {
      ...IDENTITY,
      campaign_ref: "VARCHAR",
      lead_ref: "VARCHAR",
      sender_ref: "VARCHAR",
      channel: "VARCHAR",
      sent_at: "TIMESTAMPTZ",
      category: "VARCHAR",
      category_source: "VARCHAR",
      is_auto: "BOOLEAN",
      unread: "BOOLEAN",
    },
    name: "replies",
    async *rows(source, range) {
      for await (const reply of source.replies.listAll({
        since: `${range.from}T00:00:00.000Z`,
      })) {
        yield {
          ...identity(reply),
          campaign_ref: reply.campaignRef,
          category: reply.category,
          category_source: reply.categorySource,
          channel: reply.channel,
          is_auto: reply.isAuto,
          lead_ref: reply.leadRef,
          sender_ref: reply.senderRef,
          sent_at: reply.sentAt,
          unread: reply.unread,
        };
      }
    },
  },
  {
    columns: {
      provider: "VARCHAR",
      workspace_id: "VARCHAR",
      scope: "VARCHAR",
      scope_ref: "VARCHAR",
      date: "DATE",
      evidence: "VARCHAR",
      ...METRICS,
    },
    name: "daily_metrics",
    async *rows(source, range) {
      // Campaign rows come in one call; sender rows need one call each.
      yield* metricRows(
        () => source.stats({ ...range, by: "day", scope: "campaign" }),
        "daily campaign stats"
      );

      for await (const sender of source.senders.listAll()) {
        yield* metricRows(
          () => source.sender(sender.sourceId).stats({ ...range, by: "day" }),
          `daily stats for sender ${sender.ref}`
        );
      }
    },
  },
];
