import { DatabaseSync } from "node:sqlite";

import { sqliteDedupe } from "./dedupe-store.ts";
import { createHandler } from "./handler.ts";

// Open your real database here: the dedupe table must outlive the process.
const db = new DatabaseSync(":memory:");

/** A route handler: Next.js, Hono, Bun and Deno all take this shape. */
export const POST = createHandler({
  dedupe: sqliteDedupe(db),
  now: () => new Date().toISOString(),
  save: ({ event, receivedAt }) => {
    // Write the event to your own table before doing anything else with it.
    console.log(receivedAt, event.type, event.id);
  },
  // With no secret set, every request is answered 401.
  secret: process.env.WEBHOOK_SECRET ?? "",
});
