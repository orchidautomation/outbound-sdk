// The Redis store's wiring, offline. Its script is run against a real Redis
// in test/live/redis.live.ts, where it is compared with the in-memory store.

import assert from "node:assert/strict";
import { test } from "node:test";

import { redisRateLimitStore } from "../src/redis/index.ts";
import type { RedisReply } from "../src/redis/index.ts";

const WINDOWS = [
  { perMs: 1000, requests: 3 },
  { perMs: 60_000, requests: 40 },
];

interface Call {
  readonly script: string;
  readonly keys: readonly string[];
  readonly args: readonly string[];
}

const recording = (replies: readonly RedisReply[]) => {
  const calls: Call[] = [];
  let index = 0;

  return {
    calls,
    evaluate: (
      script: string,
      keys: readonly string[],
      args: readonly string[]
    ): Promise<RedisReply> => {
      calls.push({ args, keys, script });
      index += 1;

      return Promise.resolve(replies[index - 1] ?? 0);
    },
  };
};

test("reserve sends the time, a unique member and each window, and returns the wait", async () => {
  const redis = recording([0, 250, "7"]);
  const store = redisRateLimitStore({ evaluate: redis.evaluate });
  assert.equal(await store.reserve("instantly:abc", WINDOWS, 5000), 0);
  assert.equal(await store.reserve("instantly:abc", WINDOWS, 5000), 250);
  assert.equal(await store.reserve("instantly:abc", WINDOWS, 5000), 7);

  const [first, second] = redis.calls;
  assert.deepEqual(first?.keys, [
    "outbound-sdk:rate:{instantly:abc}:log",
    "outbound-sdk:rate:{instantly:abc}:pause",
  ]);
  assert.equal(first?.args[0], "5000");
  assert.deepEqual(first?.args.slice(2), ["1000", "3", "60000", "40"]);
  assert.notEqual(
    first?.args[1],
    second?.args[1],
    "two requests in one millisecond get different members"
  );
  assert.match(first?.script ?? "", /ZADD/u);
});

test("the key prefix can be changed, and both keys share a hash tag for Redis Cluster", async () => {
  const redis = recording([0]);

  const store = redisRateLimitStore({
    evaluate: redis.evaluate,
    prefix: "acme",
  });

  await store.reserve("k#emails", [], 1);
  assert.deepEqual(redis.calls[0]?.keys, [
    "acme:{k#emails}:log",
    "acme:{k#emails}:pause",
  ]);
  assert.deepEqual(redis.calls[0]?.args.slice(2), [], "no windows, no pairs");
});

test("usage returns one count per window and reads an odd reply as zero", async () => {
  const redis = recording([[2, "17"], "nonsense", [1]]);
  const store = redisRateLimitStore({ evaluate: redis.evaluate });
  assert.deepEqual(await store.usage("k", WINDOWS, 9000), [2, 17]);
  assert.deepEqual(redis.calls[0]?.args, ["9000", "1000", "60000"]);
  assert.deepEqual(redis.calls[0]?.keys, ["outbound-sdk:rate:{k}:log"]);
  assert.deepEqual(await store.usage("k", WINDOWS, 9000), [0, 0]);
  assert.deepEqual(await store.usage("k", WINDOWS, 9000), [1, 0]);
  assert.equal(await store.reserve("k", WINDOWS, 1), 0, "a missing reply is 0");
});

test("pause sends the time to block until", async () => {
  const redis = recording([0]);
  const store = redisRateLimitStore({ evaluate: redis.evaluate });
  await store.pause("k", 123_456);
  assert.deepEqual(redis.calls[0]?.keys, ["outbound-sdk:rate:{k}:pause"]);
  assert.equal(redis.calls[0]?.args[0], "123456");
  assert.match(redis.calls[0]?.script ?? "", /'PX'/u);
});

test("when Redis cannot be reached, each call is counted in this process and reported", async () => {
  const errors: string[] = [];
  let failures = 0;

  const store = redisRateLimitStore({
    evaluate: () => {
      failures += 1;

      // A client can reject with something that is not an Error.
      return Promise.reject(
        failures === 1 ? new Error("connection refused") : "timeout"
      );
    },
    onError: (error) => {
      errors.push(error.message);
    },
  });

  const one = [{ perMs: 1000, requests: 1 }];
  assert.equal(await store.reserve("k", one, 1000), 0);
  assert.equal(await store.reserve("k", one, 1001), 999, "still limited here");
  assert.deepEqual(await store.usage("k", one, 1001), [1]);
  await store.pause("k", 5000);
  assert.equal(await store.reserve("k", one, 3000), 2000, "the pause holds");
  assert.deepEqual(errors, [
    "connection refused",
    "timeout",
    "timeout",
    "timeout",
    "timeout",
  ]);

  // Without onError the fallback is silent, never an exception.
  const quiet = redisRateLimitStore({
    evaluate: () => Promise.reject(new Error("down")),
  });

  assert.equal(await quiet.reserve("k", one, 1), 0);
});
