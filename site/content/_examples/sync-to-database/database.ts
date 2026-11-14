// The copy: three tables keyed on `ref`, and the sync checkpoints beside
// them. `node:sqlite` is built into Node; an in-memory database keeps the
// sample self-contained.
import { DatabaseSync } from "node:sqlite";
import type { SQLOutputValue } from "node:sqlite";

import type { Campaign, Lead, Reply } from "outbound-sdk";
import type { Checkpoint, CheckpointStore } from "outbound-sdk/sync";

export const openDatabase = (): DatabaseSync => {
  const db = new DatabaseSync(":memory:");

  db.exec(`
    CREATE TABLE campaigns (ref TEXT PRIMARY KEY, name TEXT, status TEXT);
    CREATE TABLE leads (
      ref TEXT PRIMARY KEY, campaign_ref TEXT, email TEXT, status TEXT
    );
    CREATE TABLE replies (
      ref TEXT PRIMARY KEY, lead_ref TEXT, category TEXT, sent_at TEXT
    );
    CREATE TABLE sync_checkpoints (
      key TEXT PRIMARY KEY, cursor TEXT, since TEXT, started_at TEXT
    );
  `);

  return db;
};

// One page is one transaction: it is written whole or not at all.
const inTransaction = (db: DatabaseSync, write: () => void): void => {
  db.exec("BEGIN");

  try {
    write();
    db.exec("COMMIT");
  } catch (error) {
    db.exec("ROLLBACK");
    throw error;
  }
};

// Every write is an upsert on `ref`, so a page delivered twice changes nothing.
export const upsertCampaigns = (
  db: DatabaseSync,
  campaigns: readonly Campaign[]
): void => {
  const upsert = db.prepare(`
    INSERT INTO campaigns (ref, name, status) VALUES (?, ?, ?)
    ON CONFLICT (ref) DO UPDATE SET
      name = excluded.name, status = excluded.status
  `);

  inTransaction(db, () => {
    for (const campaign of campaigns) {
      upsert.run(campaign.ref, campaign.name, campaign.status);
    }
  });
};

export const upsertLeads = (db: DatabaseSync, leads: readonly Lead[]): void => {
  const upsert = db.prepare(`
    INSERT INTO leads (ref, campaign_ref, email, status) VALUES (?, ?, ?, ?)
    ON CONFLICT (ref) DO UPDATE SET
      campaign_ref = excluded.campaign_ref,
      email = excluded.email,
      status = excluded.status
  `);

  inTransaction(db, () => {
    for (const lead of leads) {
      upsert.run(lead.ref, lead.campaignRef, lead.email, lead.status);
    }
  });
};

export const upsertReplies = (
  db: DatabaseSync,
  replies: readonly Reply[]
): void => {
  const upsert = db.prepare(`
    INSERT INTO replies (ref, lead_ref, category, sent_at) VALUES (?, ?, ?, ?)
    ON CONFLICT (ref) DO UPDATE SET
      lead_ref = excluded.lead_ref,
      category = excluded.category,
      sent_at = excluded.sent_at
  `);

  inTransaction(db, () => {
    for (const reply of replies) {
      upsert.run(reply.ref, reply.leadRef, reply.category, reply.sentAt);
    }
  });
};

// A column is text or NULL. The store's fields are text or absent.
const text = (value: SQLOutputValue | undefined): string | undefined =>
  value === null || value === undefined ? undefined : String(value);

/** The plugin's checkpoints, kept in the database the records are written to. */
export const sqliteCheckpoints = (db: DatabaseSync): CheckpointStore => ({
  delete: (key) => {
    db.prepare("DELETE FROM sync_checkpoints WHERE key = ?").run(key);

    return Promise.resolve();
  },
  get: (key) => {
    const row = db
      .prepare(
        "SELECT cursor, since, started_at FROM sync_checkpoints WHERE key = ?"
      )
      .get(key);

    const checkpoint: Checkpoint | undefined =
      row === undefined
        ? undefined
        : {
            cursor: text(row.cursor),
            since: text(row.since),
            startedAt: text(row.started_at),
          };

    return Promise.resolve(checkpoint);
  },
  set: (key, checkpoint) => {
    db.prepare(
      `INSERT INTO sync_checkpoints (key, cursor, since, started_at)
       VALUES (?, ?, ?, ?)
       ON CONFLICT (key) DO UPDATE SET
         cursor = excluded.cursor,
         since = excluded.since,
         started_at = excluded.started_at`
    ).run(
      key,
      checkpoint.cursor ?? null,
      checkpoint.since ?? null,
      checkpoint.startedAt ?? null
    );

    return Promise.resolve();
  },
});

export const countRows = (db: DatabaseSync, table: string): number => {
  const row = db.prepare(`SELECT count(*) AS total FROM ${table}`).get();

  return Number(row?.total ?? 0);
};
