import type { DatabaseSync } from "node:sqlite";

import { createOutbound } from "outbound-sdk";
import type { Adapter, Campaign, Lead, Reply } from "outbound-sdk";
import { sync } from "outbound-sdk/sync";
import type { SyncResult } from "outbound-sdk/sync";

import {
  sqliteCheckpoints,
  upsertCampaigns,
  upsertLeads,
  upsertReplies,
} from "./database.ts";

/** An instance whose sync checkpoints live in `db`. `now` is the clock. */
export const syncing = (
  adapter: Adapter,
  db: DatabaseSync,
  now?: () => number
) =>
  createOutbound({
    adapter,
    plugins: [sync({ checkpoints: sqliteCheckpoints(db), now })],
  });

/** Copies campaigns, leads and replies into `db`. Run it on a schedule. */
export const syncAll = async (
  outbound: ReturnType<typeof syncing>,
  db: DatabaseSync
): Promise<SyncResult[]> => [
  await outbound.sync.run<Campaign>("campaigns", {
    onPage: (campaigns) => upsertCampaigns(db, campaigns),
  }),
  await outbound.sync.run<Lead>("leads", {
    onPage: (leads) => upsertLeads(db, leads),
  }),
  await outbound.sync.run<Reply>("replies", {
    onPage: (replies) => upsertReplies(db, replies),
  }),
];

export const describe = (result: SyncResult): string =>
  `${result.collection}: ${result.records} record(s) in ${result.pages} page(s), lower bound ${result.since ?? "none"}`;
