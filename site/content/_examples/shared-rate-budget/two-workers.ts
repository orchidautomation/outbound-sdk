import { createOutbound, MemoryRateLimitStore } from "outbound-sdk";
import type { OutboundApi, RateLimitStore } from "outbound-sdk";
import { heyreach } from "outbound-sdk/heyreach";

import { documentedFetch } from "./documented-fetch.ts";

// A worker is one process holding the client's key.
const worker = (rateLimitStore: RateLimitStore) =>
  createOutbound({
    adapter: heyreach({ apiKey: "the-same-key" }),
    fetch: documentedFetch,
    rateLimitStore,
  });

const used = async (outbound: OutboundApi): Promise<string> => {
  const [snapshot] = await outbound.limits();

  return (snapshot?.windows ?? [])
    .filter((window) => window.lane === "default")
    .map(
      (window) =>
        `${window.used} of ${window.requests} per ${window.perMs / 1000}s`
    )
    .join(", ");
};

// Each process counting for itself, which is the default.
const first = worker(new MemoryRateLimitStore());
const second = worker(new MemoryRateLimitStore());

for (const outbound of [first, second]) {
  await outbound.campaigns.list();
  await outbound.campaigns.list();
  await outbound.campaigns.list();
}

console.log("separate stores");

console.log("  worker 1 sees:", await used(first));

console.log("  worker 2 sees:", await used(second));

// One store between them. In production this is redisRateLimitStore();
// one object here stands in for it, because both use the same interface.
const shared = new MemoryRateLimitStore();
const third = worker(shared);
const fourth = worker(shared);

for (const outbound of [third, fourth]) {
  await outbound.campaigns.list();
  await outbound.campaigns.list();
  await outbound.campaigns.list();
}

console.log("one shared store");

console.log("  worker 1 sees:", await used(third));

console.log("  worker 2 sees:", await used(fourth));
