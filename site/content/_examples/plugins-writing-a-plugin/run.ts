import { createOutbound } from "outbound-sdk";
import { cache } from "outbound-sdk/cache";
import { memory } from "outbound-sdk/memory";

import { seed } from "../plugins-index/seed.ts";
import { usage } from "./usage.ts";

const outbound = createOutbound({
  adapter: memory({ data: seed, pageSize: 2, workspaceId: "agency" }),
  // Inside the cache, so a cache hit is not counted as a read.
  plugins: [cache({ ttl: 60 }), usage()],
});

await outbound.leads.listAll().toArray();

await outbound.leads.listAll().toArray();

await outbound.campaign("cmp_founders").stats();

console.log(outbound.usage.operations());

console.log("records:", outbound.usage.records());

console.log("http requests:", outbound.usage.httpRequests());

// A scoped instance has the same plugin and the same counts.
console.log(outbound.workspace("agency").usage.records());
