// A virtual clock for offline runs. Rate-limit waits and time budgets are
// timers, so firing them in order, as soon as nothing else can run, makes an
// offline run fast and the same every time.

export interface VirtualClock {
  readonly now: () => number;
  readonly timer: (ms: number, onFire: () => void) => () => void;
  readonly random: () => number;
  /** Awaits `promise`, firing timers in order until it settles. */
  readonly settle: <Value>(promise: Promise<Value>) => Promise<Value>;
}

interface Timer {
  readonly at: number;
  readonly fire: () => void;
}

const turn = (): Promise<void> =>
  new Promise((resolve) => {
    setImmediate(resolve);
  });

// Turns with nothing to fire before an offline run counts as hung.
const IDLE_TURNS = 5000;

export const virtualClock = (start: number): VirtualClock => {
  const timers = new Map<number, Timer>();
  let now = start;
  let nextId = 0;

  const fireNext = (): boolean => {
    let first: [number, Timer] | undefined;

    for (const entry of timers) {
      if (first === undefined || entry[1].at < first[1].at) {
        first = entry;
      }
    }

    if (first === undefined) {
      return false;
    }

    timers.delete(first[0]);
    now = Math.max(now, first[1].at);
    first[1].fire();

    return true;
  };

  return {
    now: () => now,
    random: () => 0.5,
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

      let idle = 0;

      while (!state.settled) {
        await turn();

        if (state.settled || fireNext()) {
          idle = 0;
        } else {
          idle += 1;

          if (idle > IDLE_TURNS) {
            throw new Error(
              "An offline call is pending and no timer is scheduled"
            );
          }
        }
      }

      await watching;

      return await promise;
    },
    timer: (ms, onFire) => {
      const id = nextId;
      nextId += 1;
      timers.set(id, { at: now + ms, fire: onFire });

      return () => {
        timers.delete(id);
      };
    },
  };
};
