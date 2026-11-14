import type { RedisEvaluate } from "outbound-sdk/redis";

import { createWorker } from "./redis.ts";

// Not a Redis: it prints the keys the store would use on one, and answers 0.
const printing: RedisEvaluate = (_script, keys) => {
  console.log(keys.join("\n"));

  return Promise.resolve(0);
};

// limits() asks the store how much of each lane's budget is used.
await createWorker(printing).limits();
