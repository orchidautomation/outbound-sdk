// The Redis rate-limit store against a real Redis. Not part of `npm test`:
//
//   docker run -d -p 127.0.0.1:6399:6379 redis:7-alpine
//   LIVE_TESTS=1 REDIS_URL=redis://127.0.0.1:6399 npm run test:live

import assert from "node:assert/strict";
import { connect } from "node:net";
import type { Socket } from "node:net";
import { after, test } from "node:test";

import { createOutbound, MemoryRateLimitStore } from "../../src/index.ts";
import type { RateLimitStore } from "../../src/index.ts";
import { redisRateLimitStore } from "../../src/redis/index.ts";
import type { RedisEvaluate, RedisReply } from "../../src/redis/index.ts";
import { createFetch, json, testAdapter } from "../helpers/http.ts";

const url = process.env.REDIS_URL;
const skip = process.env.LIVE_TESTS !== "1" || !url;

interface Parsed {
  readonly reply: RedisReply;
  readonly next: number;
}

// A Redis client small enough to read: it sends one command at a time and
// parses the reply types EVAL can return.
const openRedis = (target: string) => {
  const { hostname, port } = new URL(target);
  const socket: Socket = connect(Number(port || 6379), hostname);
  let buffer = Buffer.alloc(0);
  const waiting: ((reply: RedisReply) => void)[] = [];

  const parseBulk = (line: string, end: number): Parsed | null => {
    const length = Number(line);

    if (length === -1) {
      return { next: end + 2, reply: null };
    }

    return buffer.length < end + 2 + length + 2
      ? null
      : {
          next: end + 2 + length + 2,
          reply: buffer.subarray(end + 2, end + 2 + length).toString(),
        };
  };

  const parse = (at: number): Parsed | null => {
    const end = buffer.indexOf("\r\n", at);

    if (end === -1) {
      return null;
    }

    const kind = String.fromCodePoint(buffer[at] ?? 0);
    const line = buffer.subarray(at + 1, end).toString();

    if (kind === ":") {
      return { next: end + 2, reply: Number(line) };
    }

    if (kind === "+" || kind === "-") {
      return { next: end + 2, reply: line };
    }

    if (kind === "$") {
      return parseBulk(line, end);
    }

    const items: RedisReply[] = [];
    let cursor = end + 2;

    for (let index = 0; index < Number(line); index += 1) {
      const item = parse(cursor);

      if (item === null) {
        return null;
      }

      items.push(item.reply);
      cursor = item.next;
    }

    return { next: cursor, reply: items };
  };

  socket.on("data", (chunk: Buffer) => {
    buffer = Buffer.concat([buffer, chunk]);

    for (let parsed = parse(0); parsed !== null; parsed = parse(0)) {
      buffer = buffer.subarray(parsed.next);
      waiting.shift()?.(parsed.reply);
    }
  });

  const command = (parts: readonly string[]): Promise<RedisReply> =>
    // oxlint-disable-next-line promise/avoid-new -- one reply per command, resolved by the socket.
    new Promise((resolve) => {
      waiting.push(resolve);
      socket.write(
        `*${parts.length}\r\n${parts.map((part) => `$${Buffer.byteLength(part)}\r\n${part}\r\n`).join("")}`
      );
    });

  const evaluate: RedisEvaluate = (script, keys, args) =>
    command(["EVAL", script, String(keys.length), ...keys, ...args]);

  return {
    close: () => {
      socket.destroy();
    },
    evaluate,
  };
};

const redis = skip ? undefined : openRedis(url ?? "");

after(() => {
  redis?.close();
});

const unique = (): string =>
  `test:${Date.now()}:${Math.random().toString(36).slice(2)}`;

const fresh = (): RateLimitStore => {
  assert.ok(redis);

  return redisRateLimitStore({ evaluate: redis.evaluate, prefix: unique() });
};

const WINDOWS = [
  { perMs: 1000, requests: 3 },
  { perMs: 5000, requests: 7 },
];

// Request times in milliseconds: bursts, gaps and windows rolling over.
const SCHEDULE = [
  0, 0, 1, 2, 3, 500, 999, 1000, 1001, 1002, 1500, 2100, 2100, 2101, 3000, 3200,
  4999, 5000, 5001, 6500,
];

test(
  "redis: reserve and usage answer exactly as the in-memory store does",
  { skip },
  async () => {
    const remote = fresh();
    const local = new MemoryRateLimitStore();

    for (const offset of SCHEDULE) {
      const now = 1_700_000_000_000 + offset;

      // oxlint-disable-next-line no-await-in-loop -- the order of reservations is what is being compared.
      const answers = await Promise.all([
        remote.reserve("k", WINDOWS, now),
        local.reserve("k", WINDOWS, now),
      ]);

      assert.equal(answers[0], answers[1], `reserve at +${offset} ms`);

      // oxlint-disable-next-line no-await-in-loop -- usage is read after each reservation.
      const used = await Promise.all([
        remote.usage("k", WINDOWS, now),
        local.usage("k", WINDOWS, now),
      ]);

      assert.deepEqual(used[0], used[1], `usage at +${offset} ms`);
    }
  }
);

test(
  "redis: a pause blocks the key, and a shorter pause never shortens it",
  { skip },
  async () => {
    const remote = fresh();
    const base = Date.now() + 60_000;
    await remote.pause("k", base + 400);
    assert.equal(await remote.reserve("k", WINDOWS, base), 400);
    await remote.pause("k", base + 100);
    assert.equal(await remote.reserve("k", WINDOWS, base + 50), 350);
    assert.equal(await remote.reserve("k", WINDOWS, base + 400), 0);
  }
);

test(
  "redis: two processes on one credential share one budget",
  { skip },
  async () => {
    assert.ok(redis);
    const { evaluate } = redis;
    const prefix = unique();
    let sent = 0;
    // The time each granted reservation was made at. The budget spaces
    // reservations; when a request then reaches the vendor also depends on
    // the round trip to Redis, so send times are not what is being limited.
    const reserved: number[] = [];

    const recording: RedisEvaluate = async (script, keys, args) => {
      const reply = await evaluate(script, keys, args);

      if (script.includes("ZADD") && reply === 0) {
        reserved.push(Number(args[0]));
      }

      return reply;
    };

    const worker = () => {
      const http = createFetch(() => {
        sent += 1;

        return json({ id: "c1", name: "One" });
      });

      return createOutbound({
        adapter: testAdapter({
          limits: { source: "test", windows: [{ perMs: 1000, requests: 5 }] },
        }),
        fetch: http.fetch,
        // Each worker has its own store object, as two processes would.
        rateLimitStore: redisRateLimitStore({ evaluate: recording, prefix }),
        share: 1,
      });
    };

    const workers = [worker(), worker()];

    await Promise.all(
      Array.from({ length: 12 }, (_, index) =>
        workers[index % 2]?.campaigns.get("c1")
      )
    );

    assert.equal(sent, 12, "every read went through");
    assert.equal(reserved.length, 12, "one granted reservation per read");

    // No sliding second may hold more than the 5 the two workers share.
    for (const start of reserved) {
      const inWindow = reserved.filter(
        (at) => at >= start && at < start + 1000
      );

      assert.ok(
        inWindow.length <= 5,
        `${inWindow.length} reservations in one second`
      );
    }

    assert.ok(
      Math.max(...reserved) - Math.min(...reserved) >= 2000,
      "12 reservations at 5 a second span at least two seconds"
    );
  }
);
