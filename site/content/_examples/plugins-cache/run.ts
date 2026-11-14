import { createOutbound } from "outbound-sdk";
import type { OutboundPlugin } from "outbound-sdk";
import { cache } from "outbound-sdk/cache";
import { memory } from "outbound-sdk/memory";

import { seed } from "../plugins-index/seed.ts";

// One clock for the SDK and the cache, so the sample can move time forward.
let now = Date.parse("2026-11-14T12:00:00.000Z");
const clock = (): number => now;

// Listed after the cache, so it counts only the reads the cache let through.
let reads = 0;

const counter: OutboundPlugin = {
  name: "counter",
  wrap: async (operation, next) => {
    reads += 1;

    return await next(operation);
  },
};

const outbound = createOutbound({
  adapter: memory({ data: seed, workspaceId: "agency" }),
  plugins: [cache({ now: clock, ttl: 60 }), counter],
  runtime: { now: clock },
});

const show = async (label: string): Promise<void> => {
  const page = await outbound.campaigns.list();

  console.log(
    `${label}: ${page.items.length} campaigns, fetched ${page.meta.fetchedAt}, reads so far ${reads}`
  );
};

await show("first read ");

now += 30_000;

await show("30 s later ");

// A different question is a different entry.
await outbound.campaigns.list({ status: "paused" });

console.log(`another filter: reads so far ${reads}`);

now += 30_000;

await show("60 s later ");
