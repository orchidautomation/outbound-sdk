// outbound-sdk/sync: scheduled runs that fetch only what changed.
//
// It keeps one checkpoint per collection in a store you supply: a cursor, so
// a run that dies restarts on the page it was reading, and a high-water mark,
// so the next run asks only for newer records. Nothing is stored on our side.

export { memoryCheckpointStore, sync } from "./plugin.ts";

export type {
  Checkpoint,
  CheckpointStore,
  SyncCampaignResult,
  SyncCollection,
  SyncExtension,
  SyncFilter,
  SyncOptions,
  SyncPage,
  SyncPluginOptions,
  SyncResult,
  SyncScopeResult,
  SyncSkip,
  SyncSkipReason,
} from "./types.ts";
