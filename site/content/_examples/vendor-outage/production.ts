import { createOutbound } from "outbound-sdk";
import { budget } from "outbound-sdk/budget";
import { cache, memoryCacheStore } from "outbound-sdk/cache";
import { failover } from "outbound-sdk/failover";
import { instantly } from "outbound-sdk/instantly";

// Reads INSTANTLY_API_KEY. Swap the import for smartlead() or heyreach().
export const outbound = createOutbound({
  adapter: instantly({ workspaceId: "acme" }),
  // Give up on a failing vendor after 5 seconds, retries included. Failover
  // answers only once the call has failed.
  deadline: 5000,
  plugins: [
    // This store is the process's memory: it is empty after a restart. Pass
    // your own CacheStore (Redis, a table) to keep answers across deploys.
    failover({ maxAge: 24 * 60 * 60, store: memoryCacheStore() }),
    cache({ ttl: 60 }),
    budget({ maxRequests: 200, per: "run" }),
  ],
});
