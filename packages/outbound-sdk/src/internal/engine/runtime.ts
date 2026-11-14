// The clock, the timers, the randomness and the network, behind one
// interface so tests can replace them without mocking modules.

import { OutboundError } from "../errors.ts";

export interface Runtime {
  readonly now: () => number;
  /** Runs `onFire` after `ms`. Returns a function that cancels it. */
  readonly timer: (ms: number, onFire: () => void) => () => void;
  /** A number in [0, 1), used for backoff jitter. */
  readonly random: () => number;
  readonly fetch: typeof fetch;
}

export const defaultRuntime: Runtime = {
  fetch: (input, init) => fetch(input, init),
  now: () => Date.now(),
  random: () => Math.random(),
  timer: (ms, onFire) => {
    const handle = setTimeout(onFire, ms);

    return () => {
      clearTimeout(handle);
    };
  },
};

export const abortedError = (provider: string): OutboundError =>
  new OutboundError("Provider", "The call was aborted", {
    aborted: true,
    provider,
  });

/** Waits `ms`, or rejects as soon as `signal` aborts. */
export const sleep = (
  runtime: Runtime,
  ms: number,
  provider: string,
  signal?: AbortSignal
): Promise<void> =>
  // oxlint-disable-next-line promise/avoid-new -- wraps a callback timer.
  new Promise((resolve, reject) => {
    if (signal?.aborted) {
      reject(abortedError(provider));

      return;
    }

    const onAbort = (): void => {
      cancel();
      reject(abortedError(provider));
    };

    const cancel = runtime.timer(Math.max(0, ms), () => {
      signal?.removeEventListener("abort", onAbort);
      resolve();
    });

    signal?.addEventListener("abort", onAbort, { once: true });
  });
