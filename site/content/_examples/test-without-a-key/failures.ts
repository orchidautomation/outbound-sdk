import assert from "node:assert/strict";

import { createOutbound, OutboundError } from "outbound-sdk";
import { memory } from "outbound-sdk/memory";

import { failing } from "./failing.ts";
import { seed } from "./seed.ts";
import { campaignSummary } from "./summary.ts";

// 1. Turn a capability off and the call is refused before it reaches the
//    adapter, as it would be on a vendor that lacks it.
const noStats = createOutbound({
  adapter: memory({ capabilities: { "stats.campaign": false }, data: seed }),
});

await assert.rejects(
  campaignSummary(noStats),
  (error) => OutboundError.is(error) && error.code === "Unsupported"
);

console.log("ok - no campaign stats: Unsupported");

// 2. A capability the code checks for itself: the fallback branch runs.
const noCategories = createOutbound({
  adapter: memory({ capabilities: { "replies.category": false }, data: seed }),
});

const [line] = await campaignSummary(noCategories);

assert.equal(line?.positiveReplies, null);

assert.equal(line?.sent, 200);

console.log("ok - no reply categories: positiveReplies is null");

// 3. A vendor error reaches the caller as an OutboundError with its code.
const down = createOutbound({
  adapter: memory({ data: seed }),
  plugins: [failing("Provider")],
});

await assert.rejects(campaignSummary(down), (error) => {
  assert.ok(OutboundError.is(error));
  assert.equal(error.code, "Provider");
  assert.equal(error.permanent, false, "worth trying again");

  return true;
});

// The plugin failed one operation, so the second attempt goes through.
const secondTry = await campaignSummary(down);

assert.equal(secondTry.length, 2);

console.log("ok - Provider once, then the retry succeeds");

// 4. A rate limit carries how long the vendor asked you to wait.
const limited = createOutbound({
  adapter: memory({ data: seed }),
  plugins: [failing("RateLimited", 1, 30_000)],
});

await assert.rejects(limited.campaigns.list(), (error) => {
  assert.ok(OutboundError.is(error));
  assert.equal(error.retryAfterMs, 30_000);

  return true;
});

console.log("ok - RateLimited carries retryAfterMs");

// 5. A rejected key is permanent: retrying cannot help.
const rejected = createOutbound({
  adapter: memory({ data: seed }),
  plugins: [failing("Unauthorized", Number.POSITIVE_INFINITY)],
});

await assert.rejects(rejected.campaigns.list(), (error) => {
  assert.ok(OutboundError.is(error));
  assert.equal(error.permanent, true);

  return true;
});

console.log("ok - Unauthorized is permanent");

// 6. A bulk lookup reports a missing record as data. It does not throw.
const outbound = createOutbound({ adapter: memory({ data: seed }) });
const bulk = await outbound.campaigns.getMany(["cmp_founders", "cmp_nope"]);

assert.deepEqual(
  bulk.results.map((result) => result.value.name),
  ["SaaS founders"]
);

assert.deepEqual(
  bulk.errors.map((failure) => [failure.id, failure.error.code]),
  [["cmp_nope", "NotFound"]]
);

assert.equal(await outbound.campaigns.exists("cmp_nope"), false);

console.log("ok - getMany returns the missing record as an error entry");
