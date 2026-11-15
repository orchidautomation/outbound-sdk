// outbound-sdk/cache: serves repeat reads from a store, to save rate budget.
//
// The store is supplied by the caller; the default keeps entries in this
// process's memory. Nothing is stored on our side. A cached answer carries
// the time it was originally fetched in `meta.fetchedAt`. An answer a layer
// inside marked stale is passed on but never stored.

import type {
  Operation,
  OperationOutput,
} from "../internal/outbound/operations.ts";
import type { OutboundPlugin } from "../internal/outbound/plugins.ts";
import { stableId } from "../internal/sha256.ts";

export interface CacheEntry {
  readonly output: OperationOutput;
  /** When the answer was fetched, as an epoch in milliseconds. */
  readonly storedAt: number;
}

export interface CacheStore {
  readonly get: (key: string) => Promise<CacheEntry | undefined>;
  readonly set: (
    key: string,
    entry: CacheEntry,
    ttlMs: number
  ) => Promise<void>;
  readonly delete: (key: string) => Promise<void>;
}

export interface CacheOptions {
  /** How long an answer may be reused, in seconds. */
  readonly ttl: number;
  readonly store?: CacheStore | undefined;
  /** Which operations to cache. Defaults to all of them. */
  readonly only?: readonly Operation["kind"][] | undefined;
  /** The clock, for tests. */
  readonly now?: (() => number) | undefined;
}

/** An in-memory store that drops its oldest entry once it is full. */
export const memoryCacheStore = (maxEntries = 500): CacheStore => {
  const entries = new Map<string, CacheEntry>();

  return {
    delete: (key) => {
      entries.delete(key);

      return Promise.resolve();
    },
    get: (key) => Promise.resolve(entries.get(key)),
    set: (key, entry) => {
      entries.delete(key);
      entries.set(key, entry);

      if (entries.size > maxEntries) {
        const [oldest] = entries.keys();

        if (oldest !== undefined) {
          entries.delete(oldest);
        }
      }

      return Promise.resolve();
    },
  };
};

export interface CacheScope {
  readonly provider: string;
  readonly workspaceId: string;
}

/** The store key for one operation on one credential. */
export const cacheKey = (scope: CacheScope, operation: Operation): string =>
  `outbound:${stableId(scope.provider, scope.workspaceId, JSON.stringify(operation))}`;

/** Serves repeat reads from a store. */
export const cache = (options: CacheOptions): OutboundPlugin => {
  const store = options.store ?? memoryCacheStore();
  const now = options.now ?? (() => Date.now());
  const ttlMs = options.ttl * 1000;
  const kinds = options.only === undefined ? undefined : new Set(options.only);

  return {
    name: "cache",
    wrap: async (operation, next, info) => {
      if (ttlMs <= 0 || (kinds !== undefined && !kinds.has(operation.kind))) {
        return await next(operation);
      }

      const key = cacheKey(info, operation);
      const hit = await store.get(key);

      if (hit !== undefined && now() - hit.storedAt < ttlMs) {
        return {
          ...hit.output,
          fetchedAt: new Date(hit.storedAt).toISOString(),
        };
      }

      const output = await next(operation);

      // A stale answer is the failover plugin's stand-in for a failed read, and
      // an answer a tool is missing from would hide that tool once it is back.
      if (output.stale !== true && output.failures === undefined) {
        // A layer inside that served the answer from a store says when the
        // vendor was asked; that time is kept, not the time of this write.
        const storedAt =
          output.fetchedAt === undefined ? now() : Date.parse(output.fetchedAt);

        await store.set(key, { output, storedAt }, ttlMs);
      }

      return output;
    },
  };
};
