// outbound-sdk/redis: one rate budget shared by every process on a
// credential. The in-memory store counts requests per process, so three
// workers on one key each spend their own share; with this store they spend
// one share between them.
//
// The package ships no Redis client. Pass a function that runs a Lua script
// on yours; ioredis, node-redis, Upstash and Valkey all can.

import { MemoryRateLimitStore } from "../internal/engine/rate-store.ts";
import type { RateLimitStore } from "../internal/engine/rate-store.ts";
import type { RateWindow } from "../internal/limits.ts";

/** What a Redis script can answer with. */
export type RedisReply = number | string | null | readonly RedisReply[];

/**
 * Runs a Lua script on Redis and resolves with its reply.
 *
 * - ioredis: `(script, keys, args) => redis.eval(script, keys.length, ...keys, ...args)`
 * - node-redis: `(script, keys, args) => client.eval(script, { keys, arguments: args })`
 * - Upstash: `(script, keys, args) => redis.eval(script, keys, args)`
 */
export type RedisEvaluate = (
  script: string,
  keys: readonly string[],
  args: readonly string[]
) => Promise<RedisReply>;

export interface RedisRateLimitOptions {
  readonly evaluate: RedisEvaluate;
  /** Prepended to every key. Defaults to `outbound-sdk:rate`. */
  readonly prefix?: string | undefined;
  /**
   * Called when Redis cannot be reached. The request is then counted in this
   * process only, so a Redis outage slows nothing down and still limits each
   * process on its own.
   */
  readonly onError?: ((cause: Error) => void) | undefined;
}

// A sliding-window log in a sorted set: one member per request, scored by
// its time. The whole check runs in one script, so two processes can never
// both take the last slot.
//
// KEYS[1] the log, KEYS[2] the pause. ARGV: now, a unique member, then one
// (window length in ms, requests allowed) pair per window.
const RESERVE = `
local now = tonumber(ARGV[1])
local paused = tonumber(redis.call('GET', KEYS[2]) or '0')
if paused > now then return paused - now end
local longest = 0
local wait = 0
for i = 3, #ARGV, 2 do
  local per = tonumber(ARGV[i])
  local limit = tonumber(ARGV[i + 1])
  if per > longest then longest = per end
  local used = redis.call('ZCOUNT', KEYS[1], '(' .. (now - per), '+inf')
  if used >= limit then
    local blocker = redis.call('ZREVRANGE', KEYS[1], limit - 1, limit - 1, 'WITHSCORES')
    local w = tonumber(blocker[2] or now) + per - now
    if w < 1 then w = 1 end
    if w > wait then wait = w end
  end
end
if wait > 0 then return wait end
redis.call('ZREMRANGEBYSCORE', KEYS[1], '-inf', now - longest)
redis.call('ZADD', KEYS[1], now, ARGV[2])
redis.call('PEXPIRE', KEYS[1], longest + 1000)
return 0
`;

// KEYS[1] the pause. ARGV: until, now. A later pause is never shortened.
const PAUSE = `
local current = tonumber(redis.call('GET', KEYS[1]) or '0')
local wanted = tonumber(ARGV[1])
if wanted > current then
  redis.call('SET', KEYS[1], ARGV[1], 'PX', math.max(1, wanted - tonumber(ARGV[2])))
end
return 0
`;

// KEYS[1] the log. ARGV: now, then each window's length in ms.
const USAGE = `
local now = tonumber(ARGV[1])
local used = {}
for i = 2, #ARGV do
  used[#used + 1] = redis.call('ZCOUNT', KEYS[1], '(' .. (now - tonumber(ARGV[i])), '+inf')
end
return used
`;

const DEFAULT_PREFIX = "outbound-sdk:rate";

const toError = (cause: unknown): Error =>
  cause instanceof Error ? cause : new Error(String(cause));

const toCount = (reply: RedisReply): number => {
  const value = Number(reply);

  return Number.isFinite(value) ? value : 0;
};

let sequence = 0;

// Two requests in the same millisecond need different members.
const member = (now: number): string => {
  sequence = (sequence + 1) % Number.MAX_SAFE_INTEGER;

  return `${now}-${sequence}-${Math.random().toString(36).slice(2)}`;
};

/**
 * A rate budget kept in Redis, so every process, worker or serverless
 * invocation on one credential draws on the same budget.
 *
 * ```ts
 * createOutbound({
 *   adapter: instantly(),
 *   rateLimitStore: redisRateLimitStore({
 *     evaluate: (script, keys, args) =>
 *       redis.eval(script, keys.length, ...keys, ...args),
 *   }),
 * });
 * ```
 *
 * Request times come from each process's own clock, so keep the machines'
 * clocks in step (NTP does). If Redis cannot be reached the request is
 * counted in this process only and `onError` is told.
 */
export const redisRateLimitStore = (
  options: RedisRateLimitOptions
): RateLimitStore => {
  const { evaluate, onError } = options;
  const prefix = options.prefix ?? DEFAULT_PREFIX;
  const local = new MemoryRateLimitStore();
  const log = (key: string): string => `${prefix}:{${key}}:log`;
  const pauseKey = (key: string): string => `${prefix}:{${key}}:pause`;

  const guarded = async <Result>(
    remote: () => Promise<Result>,
    fallback: () => Promise<Result>
  ): Promise<Result> => {
    try {
      return await remote();
    } catch (error) {
      onError?.(toError(error));

      return await fallback();
    }
  };

  return {
    pause: (key, until) =>
      guarded(
        async () => {
          await evaluate(
            PAUSE,
            [pauseKey(key)],
            [String(until), String(Date.now())]
          );
        },
        () => local.pause(key, until)
      ),
    reserve: (key, windows, now) =>
      guarded(
        async () =>
          toCount(
            await evaluate(
              RESERVE,
              [log(key), pauseKey(key)],
              [
                String(now),
                member(now),
                ...windows.flatMap((window: RateWindow) => [
                  String(window.perMs),
                  String(window.requests),
                ]),
              ]
            )
          ),
        () => local.reserve(key, windows, now)
      ),
    usage: (key, windows, now) =>
      guarded(
        async () => {
          const reply = await evaluate(
            USAGE,
            [log(key)],
            [String(now), ...windows.map((window) => String(window.perMs))]
          );

          return Array.isArray(reply)
            ? windows.map((_window, index) => toCount(reply[index] ?? 0))
            : windows.map(() => 0);
        },
        () => local.usage(key, windows, now)
      ),
  };
};
