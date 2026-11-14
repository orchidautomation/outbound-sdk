import { createOutbound } from "outbound-sdk";
import type { CacheEntry, CacheStore } from "outbound-sdk/cache";
import { failover } from "outbound-sdk/failover";
import { memory } from "outbound-sdk/memory";

import { seed } from "../plugins-index/seed.ts";
import { outage, vendor } from "./outage.ts";

// failover takes the same store interface as the cache plugin: three async
// functions. An entry is plain data, so a real store can keep it as JSON in
// a file, a table or Redis and outlive the process. This one copies each
// entry into a Map and drops it once the time it was given has passed.
const rows = new Map<string, { entry: CacheEntry; expiresAt: number }>();

const store: CacheStore = {
  delete: (key) => {
    rows.delete(key);

    return Promise.resolve();
  },
  get: (key) => {
    const row = rows.get(key);

    return Promise.resolve(
      row === undefined || row.expiresAt <= Date.now() ? undefined : row.entry
    );
  },
  // `ttlMs` is the plugin's maxAge, so the store can expire entries itself.
  set: (key, entry, ttlMs) => {
    rows.set(key, {
      entry: structuredClone(entry),
      expiresAt: Date.now() + ttlMs,
    });

    return Promise.resolve();
  },
};

const outbound = createOutbound({
  adapter: memory({ data: seed, workspaceId: "agency" }),
  plugins: [failover({ store }), outage],
});

await outbound.campaigns.list();

await outbound.campaign("cmp_founders").stats();

console.log([...rows.keys()].map((key) => key.slice(0, 18)));

vendor.down = true;

const stats = await outbound.campaign("cmp_founders").stats();

console.log("sent:", stats.rows[0]?.sent, "stale:", stats.meta.stale);
