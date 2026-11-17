// The warehouse: a DuckDB database with one table per collection, keyed on
// `ref`, and the sync checkpoints beside them. `:memory:` keeps the sample
// self-contained; pass a file path such as `outbound.duckdb` to keep it.
import { DuckDBInstance } from "@duckdb/node-api";
import type { DuckDBConnection } from "@duckdb/node-api";
import type { Campaign, Lead, MetricRow, Reply } from "outbound-sdk";
import type { Checkpoint, CheckpointStore } from "outbound-sdk/sync";

export const openWarehouse = async (
  file = ":memory:"
): Promise<DuckDBConnection> => {
  const instance = await DuckDBInstance.create(file);
  const db = await instance.connect();

  await db.run(`
    CREATE TABLE IF NOT EXISTS campaigns (
      ref TEXT PRIMARY KEY, provider TEXT, workspace_id TEXT,
      name TEXT, status TEXT, channel TEXT
    );
    CREATE TABLE IF NOT EXISTS leads (
      ref TEXT PRIMARY KEY, campaign_ref TEXT, email TEXT, status TEXT,
      created_at TIMESTAMPTZ
    );
    CREATE TABLE IF NOT EXISTS replies (
      ref TEXT PRIMARY KEY, campaign_ref TEXT, lead_ref TEXT,
      category TEXT, sent_at TIMESTAMPTZ
    );
    CREATE TABLE IF NOT EXISTS daily_stats (
      campaign_ref TEXT, day DATE, sent INTEGER, contacted INTEGER,
      replied INTEGER, PRIMARY KEY (campaign_ref, day)
    );
    CREATE TABLE IF NOT EXISTS sync_checkpoints (
      key TEXT PRIMARY KEY, cursor TEXT, since TEXT, started_at TEXT
    );
  `);

  return db;
};

// One page is one transaction, and every write replaces the row with the
// same key, so a page delivered twice changes nothing.
const upsert = async (
  db: DuckDBConnection,
  sql: string,
  rows: readonly (readonly (string | number | null)[])[]
): Promise<void> => {
  await db.run("BEGIN TRANSACTION");

  try {
    for (const row of rows) {
      // oxlint-disable-next-line no-await-in-loop -- one connection runs one statement at a time.
      await db.run(sql, [...row]);
    }

    await db.run("COMMIT");
  } catch (error) {
    await db.run("ROLLBACK");
    throw error;
  }
};

export const upsertCampaigns = async (
  db: DuckDBConnection,
  campaigns: readonly Campaign[]
): Promise<void> =>
  await upsert(
    db,
    "INSERT OR REPLACE INTO campaigns VALUES ($1, $2, $3, $4, $5, $6)",
    campaigns.map((each) => [
      each.ref,
      each.provider,
      each.workspaceId,
      each.name,
      each.status,
      each.channel,
    ])
  );

export const upsertLeads = async (
  db: DuckDBConnection,
  leads: readonly Lead[]
): Promise<void> =>
  await upsert(
    db,
    "INSERT OR REPLACE INTO leads VALUES ($1, $2, $3, $4, $5)",
    leads.map((each) => [
      each.ref,
      each.campaignRef,
      each.email,
      each.status,
      each.createdAt,
    ])
  );

export const upsertReplies = async (
  db: DuckDBConnection,
  replies: readonly Reply[]
): Promise<void> =>
  await upsert(
    db,
    "INSERT OR REPLACE INTO replies VALUES ($1, $2, $3, $4, $5)",
    replies.map((each) => [
      each.ref,
      each.campaignRef,
      each.leadRef,
      each.category,
      each.sentAt,
    ])
  );

/** Daily rows replace the same campaign and day, so a day re-read later overwrites its first count. */
export const upsertDailyStats = async (
  db: DuckDBConnection,
  rows: readonly MetricRow[]
): Promise<void> =>
  await upsert(
    db,
    "INSERT OR REPLACE INTO daily_stats VALUES ($1, $2, $3, $4, $5)",
    rows.map((row) => [
      row.scopeRef,
      row.date,
      row.sent,
      row.contacted,
      row.replied,
    ])
  );

/** The sync plugin's checkpoints, kept in the warehouse beside the records. */
export const duckdbCheckpoints = (db: DuckDBConnection): CheckpointStore => ({
  delete: async (key) => {
    await db.run("DELETE FROM sync_checkpoints WHERE key = $1", [key]);
  },
  get: async (key) => {
    const reader = await db.runAndReadAll(
      "SELECT cursor, since, started_at FROM sync_checkpoints WHERE key = $1",
      [key]
    );

    const [row] = reader.getRowObjectsJson();

    const checkpoint: Checkpoint | undefined =
      row === undefined
        ? undefined
        : {
            cursor: row.cursor === null ? undefined : String(row.cursor),
            since: row.since === null ? undefined : String(row.since),
            startedAt:
              row.started_at === null ? undefined : String(row.started_at),
          };

    return checkpoint;
  },
  set: async (key, checkpoint) => {
    await db.run(
      "INSERT OR REPLACE INTO sync_checkpoints VALUES ($1, $2, $3, $4)",
      [
        key,
        checkpoint.cursor ?? null,
        checkpoint.since ?? null,
        checkpoint.startedAt ?? null,
      ]
    );
  },
});

/** Prints a query's rows, one per line. */
export const show = async (
  db: DuckDBConnection,
  sql: string
): Promise<void> => {
  const reader = await db.runAndReadAll(sql);

  for (const row of reader.getRowObjectsJson()) {
    console.log(`  ${JSON.stringify(row)}`);
  }
};
