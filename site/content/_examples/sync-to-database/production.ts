import { createOutbound } from "outbound-sdk";
import { instantly } from "outbound-sdk/instantly";
import { sync } from "outbound-sdk/sync";

import { openDatabase, sqliteCheckpoints } from "./database.ts";

// Open your real database here. The checkpoints must outlive the process.
export const db = openDatabase();

// Reads INSTANTLY_API_KEY. Swap the import for smartlead() or heyreach().
export const outbound = createOutbound({
  adapter: instantly({ workspaceId: "acme" }),
  plugins: [sync({ checkpoints: sqliteCheckpoints(db) })],
});
