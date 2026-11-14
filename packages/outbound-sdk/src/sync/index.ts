// outbound-sdk/sync: scheduled runs that fetch only what changed.
//
// It keeps one checkpoint per collection in a store you supply: a cursor, so
// a run that dies restarts on the page it was reading, and a high-water mark,
// so the next run asks only for newer records. Nothing is stored on our side.

export { memoryCheckpointStore, sync } from "./plugin.ts";

export type {
  Checkpoint,
  CheckpointStore,
  SyncCollection,
  SyncExtension,
  SyncOptions,
  SyncPluginOptions,
  SyncResult,
} from "./plugin.ts";
