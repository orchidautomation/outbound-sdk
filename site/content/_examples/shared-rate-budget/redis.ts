import { createOutbound } from "outbound-sdk";
import { instantly } from "outbound-sdk/instantly";
import { redisRateLimitStore } from "outbound-sdk/redis";
import type { RedisEvaluate } from "outbound-sdk/redis";

// The package ships no Redis client. `evaluate` runs a Lua script on yours:
//
//   ioredis:    (script, keys, args) => redis.eval(script, keys.length, ...keys, ...args)
//   node-redis: (script, keys, args) => client.eval(script, { keys, arguments: args })
//   Upstash:    (script, keys, args) => redis.eval(script, keys, args)
export const createWorker = (evaluate: RedisEvaluate) =>
  createOutbound({
    adapter: instantly(),
    rateLimitStore: redisRateLimitStore({
      evaluate,
      // Redis unreachable: this process counts for itself until it is back.
      onError: (cause) => {
        console.error("rate budget is not shared right now:", cause.message);
      },
      prefix: "acme:outbound",
    }),
  });
