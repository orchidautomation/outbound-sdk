// What the CLI tells a person while a command waits on a rate limit, and how
// long the command waited in all. Without it a read on a slow lane, such as
// Instantly's list-email endpoint at 20 requests a minute, sits silent for a
// minute and looks hung.

import type { OutboundHooks, ThrottleEvent } from "../internal/hooks.ts";
import { findProvider } from "../providers/index.ts";

/** A wait longer than this gets a line on stderr. */
export const SAY_AFTER_MS = 2000;

/** How long a run has waited on rate limits so far, and why it last did. */
export interface ThrottleTotal {
  /**
   * Wall-clock milliseconds spent with a wait under way, up to now: a wait
   * counts as it elapses, not when it is booked, and waits that overlap are
   * counted once.
   */
  readonly ms: number;
  /** The last wait, in words, or `undefined` before any wait. */
  readonly reason: string | undefined;
}

/** Hooks for `createOutbound`, not a plugin, so the MCP server does not list it among the plugins on. */
export interface ThrottleMonitor {
  readonly hooks: OutboundHooks;
  readonly total: () => ThrottleTotal;
}

const UNITS: readonly (readonly [number, string])[] = [
  [86_400_000, "day"],
  [3_600_000, "hour"],
  [60_000, "minute"],
  [1000, "second"],
];

const per = (perMs: number): string => {
  const unit = UNITS.find(([ms]) => perMs === ms);

  return unit === undefined ? `per ${perMs / 1000}s` : `a ${unit[1]}`;
};

const seconds = (ms: number): string =>
  `${Math.max(1, Math.round(ms / 1000))}s`;

const nameOf = (provider: string): string =>
  findProvider(provider)?.name ?? provider;

const rates = (windows: ThrottleEvent["windows"]): string =>
  windows
    .map((window) => `${window.requests} ${per(window.perMs)}`)
    .join(" and ");

// The vendor's published limit, then the rate this process keeps to when it
// is lower: its share of the limit, slowed further after a 429.
const limitOf = (event: ThrottleEvent): string => {
  const lane = event.lane === "default" ? "" : ` ${event.lane}`;
  const declared = rates(event.declared);
  const current = rates(event.windows);

  const shown =
    current === declared
      ? declared
      : `${declared}; this process reads up to ${current}`;

  return `${nameOf(event.provider)}'s${lane} rate limit${declared === "" ? "" : ` (${shown})`}`;
};

/** One wait, in the words stderr and a tool note use. */
export const describeWait = (event: ThrottleEvent): string =>
  event.cause === "vendor"
    ? `Throttled by ${nameOf(event.provider)}: it answered 429 on ${limitOf(event)}, most likely because another process or tool on the same workspace is reading it too. Retrying in ${seconds(event.waitMs)}. To share one budget between processes, list a rateLimitStore in a --config file.`
    : `Waiting ${seconds(event.waitMs)} for ${limitOf(event)}…`;

/**
 * Counts the time a run spends waiting on rate limits and, through `say`,
 * prints one line when a wait passes `SAY_AFTER_MS`. Requests that wait
 * together, as a call's parallel reads do, print one line between them.
 */
export const throttleMonitor = (
  now: () => number,
  say: (text: string) => void
): ThrottleMonitor => {
  // Waits start in time order, so the time covered is the spans already
  // closed plus the part of the current span that has passed.
  let closedMs = 0;
  let spanStart = 0;
  let spanEnd = 0;
  let reason: string | undefined;
  const quietUntil = new Map<string, number>();

  return {
    hooks: {
      onThrottle: (event) => {
        const start = now();
        const end = start + event.waitMs;

        if (start > spanEnd) {
          closedMs += spanEnd - spanStart;
          spanStart = start;
          spanEnd = end;
        } else {
          spanEnd = Math.max(spanEnd, end);
        }

        reason = describeWait(event);
        const key = `${event.provider}#${event.lane}#${event.cause}`;

        if (
          event.waitMs > SAY_AFTER_MS &&
          start >= (quietUntil.get(key) ?? Number.NEGATIVE_INFINITY)
        ) {
          quietUntil.set(key, end);
          say(reason);
        }
      },
    },
    total: () => ({
      ms: closedMs + Math.max(0, Math.min(now(), spanEnd) - spanStart),
      reason,
    }),
  };
};
