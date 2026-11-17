// A redacted warehouse: load with redact on and the same key every run, so
// a person keeps one token from one load to the next and the warehouse
// never holds an address. Without a key each run writes new tokens, and
// nothing joins across loads.
import { createOutbound } from "outbound-sdk";
import { memory } from "outbound-sdk/memory";
import { redact } from "outbound-sdk/redact";

import { seed } from "./seed.ts";
import { openWarehouse, show, upsertLeads } from "./warehouse.ts";

// For this sample only: read yours from a secret store, for example
// process.env.OUTBOUND_REDACT_KEY.
const key = "sample-only-key-0123456789abcdef0123";

// One load, as one scheduled run would make it.
const load = async (options: { key?: string }) =>
  await createOutbound({
    adapter: memory({ data: seed, workspaceId: "acme" }),
    plugins: [redact(options)],
  })
    .leads.listAll()
    .toArray();

const db = await openWarehouse();

await upsertLeads(db, await load({ key }));

await db.run("CREATE TABLE monday AS SELECT ref, email FROM leads");

// The next day's run is a new process with the same key.
await upsertLeads(db, await load({ key }));

console.log("the same key, a day apart:");

await show(
  db,
  `SELECT count(*)::INTEGER AS leads,
          (count(*) FILTER (l.email = m.email))::INTEGER AS same_token,
          (count(*) FILTER (l.email LIKE '%@%'))::INTEGER AS addresses
     FROM leads l JOIN monday m USING (ref)`
);

await upsertLeads(db, await load({}));

console.log("a run with no key:");

await show(
  db,
  `SELECT (count(*) FILTER (l.email = m.email))::INTEGER AS same_token
     FROM leads l JOIN monday m USING (ref)`
);
