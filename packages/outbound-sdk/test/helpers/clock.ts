// A virtual clock for tests. Timers never fire on their own: `settle` pumps
// them in order while a promise is pending, so retries, throttle waits and
// timeouts run instantly and deterministically.

import type { Runtime } from "../../src/index.ts";

interface Timer {
  readonly at: number;
  readonly fire: () => void;
}

const turn = (): Promise<void> =>
  new Promise((resolve) => {
    setImmediate(resolve);
  });

export interface Clock {
  readonly runtime: Pick<Runtime, "now" | "random" | "timer">;
  /** Milliseconds of virtual time that have passed. */
  readonly elapsed: () => number;
  /** Awaits `promise`, firing timers in order until it settles. */
  readonly settle: <Value>(promise: Promise<Value>) => Promise<Value>;
  /** Moves the clock forward without firing timers. */
  readonly advance: (ms: number) => void;
}

export const createClock = (random = 0.5): Clock => {
  const start = Date.UTC(2026, 0, 1);
  const timers = new Map<number, Timer>();
  let now = start;
  let nextId = 0;

  const fireNext = (): boolean => {
    const [first] = [...timers.entries()].toSorted(
      ([, left], [, right]) => left.at - right.at
    );

    if (first === undefined) {
      return false;
    }

    const [id, timer] = first;
    timers.delete(id);
    now = Math.max(now, timer.at);
    timer.fire();

    return true;
  };

  return {
    advance: (ms) => {
      now += ms;
    },
    elapsed: () => now - start,
    runtime: {
      now: () => now,
      random: () => random,
      timer: (ms, fire) => {
        const id = nextId;
        nextId += 1;
        timers.set(id, { at: now + ms, fire });

        return () => {
          timers.delete(id);
        };
      },
    },
    settle: async (promise) => {
      const state = { settled: false };

      const watch = async (): Promise<void> => {
        try {
          await promise;
        } catch {
          // The caller awaits the same promise below and sees the rejection.
        } finally {
          state.settled = true;
        }
      };

      const watching = watch();
      let idleTurns = 0;

      while (!state.settled) {
        await turn();

        if (!state.settled && !fireNext()) {
          idleTurns += 1;

          if (idleTurns > 50) {
            throw new Error("The promise is pending and no timer is scheduled");
          }
        }
      }

      await watching;

      return await promise;
    },
  };
};
