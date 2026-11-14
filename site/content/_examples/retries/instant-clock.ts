import type { Runtime } from "outbound-sdk";

// A clock for the samples: a wait of any length ends at once and moves the
// clock forward by that length. Backoff, throttle waits and timeouts then
// run in no real time, and `random` is fixed so the delays are the same on
// every run. Pass it as `runtime`. It is meant for tests, not production.
export const instantClock = (): Pick<Runtime, "now" | "random" | "timer"> => {
  let now = Date.now();

  return {
    now: () => now,
    random: () => 0.5,
    timer: (ms, onFire) => {
      const handle = setTimeout(() => {
        now += ms;
        onFire();
      }, 0);

      return () => {
        clearTimeout(handle);
      };
    },
  };
};
