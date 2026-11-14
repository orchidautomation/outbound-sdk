import { OutboundError } from "outbound-sdk";

import { build } from "./instance.ts";

const { outbound, pass, vendor } = build();

// The same read every time. What changes is where the answer comes from.
const read = async (label: string): Promise<void> => {
  const { meta } = await outbound.campaigns.list();

  console.log(
    `${label}: stale ${meta.stale}, fetched ${meta.fetchedAt.slice(11, 19)}, requests ${meta.requests}`
  );
};

// 12:00. The vendor is up.
await read("12:00 vendor up");

// 12:00:30. The same read again is served by the cache.
pass(0.5);

await read("12:00 same read");

// 12:10. The vendor is down and the cached answer has expired.
pass(9.5);

vendor.fail("Provider");

await read("12:10 vendor down");

// A read that never succeeded has no last good answer.
try {
  await outbound.campaign("cmp_founders").stats();
} catch (error) {
  if (OutboundError.is(error)) {
    console.log(`12:10 first-time read: ${error.code} - ${error.message}`);
  }
}

// 12:20. The vendor answers 429 instead. Same treatment.
pass(10);

vendor.fail("RateLimited");

await read("12:20 rate limited");

// 12:30. The vendor is back.
pass(10);

vendor.recover();

await read("12:30 vendor up");
