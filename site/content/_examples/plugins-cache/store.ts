import { createOutbound } from "outbound-sdk";
import { cache, cacheKey } from "outbound-sdk/cache";
import type { CacheEntry, CacheStore } from "outbound-sdk/cache";
import { memory } from "outbound-sdk/memory";

import { seed } from "../plugins-index/seed.ts";

// A store is three async functions. This one keeps entries in a Map and
// honours the time to live itself, as Redis or a database table would.
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
  set: (key, entry, ttlMs) => {
    rows.set(key, { entry, expiresAt: Date.now() + ttlMs });

    return Promise.resolve();
  },
};

const outbound = createOutbound({
  adapter: memory({ data: seed, workspaceId: "agency" }),
  // Cache only the campaign lookups.
  plugins: [cache({ only: ["campaigns.get"], store, ttl: 300 })],
});

await outbound.campaigns.list();

await outbound.campaigns.get("cmp_founders");

console.log("entries:", rows.size);

// The key for one read on one credential, to drop an entry by hand.
const key = cacheKey(
  { provider: outbound.provider, workspaceId: outbound.workspaceId },
  { id: "cmp_founders", kind: "campaigns.get" }
);

console.log("stored under this key:", rows.has(key), key.slice(0, 9));

await store.delete(key);

console.log("entries after delete:", rows.size);
