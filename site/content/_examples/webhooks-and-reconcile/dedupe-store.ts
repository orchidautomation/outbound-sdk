import type { DatabaseSync } from "node:sqlite";

import type { DedupeStore } from "outbound-sdk/webhooks";

/**
 * A dedupe store in your own database, so every process behind the endpoint
 * agrees on what was handled. The insert is the claim: it succeeds once.
 */
export const sqliteDedupe = (db: DatabaseSync): DedupeStore => {
  db.exec(`
    CREATE TABLE IF NOT EXISTS webhook_events (
      id TEXT PRIMARY KEY, claimed_at TEXT NOT NULL
    )
  `);

  const insert = db.prepare(`
    INSERT INTO webhook_events (id, claimed_at) VALUES (?, ?)
    ON CONFLICT (id) DO NOTHING
  `);

  return {
    claim: (id) => {
      const { changes } = insert.run(id, new Date().toISOString());

      return Promise.resolve(Number(changes) === 1);
    },
  };
};
