import type { Checkpoint, CheckpointStore } from "outbound-sdk/sync";

// A checkpoint store is three async functions over a key and a small JSON
// value. This one keeps them in a Map and prints each write. In production
// the same three functions read and write a row in your database.
const saved = new Map<string, Checkpoint>();

export const checkpoints: CheckpointStore = {
  delete: (key) => {
    saved.delete(key);
    console.log("  checkpoint deleted");

    return Promise.resolve();
  },
  get: (key) => Promise.resolve(saved.get(key)),
  set: (key, checkpoint) => {
    saved.set(key, checkpoint);
    console.log("  checkpoint saved:", JSON.stringify(checkpoint));

    return Promise.resolve();
  },
};
