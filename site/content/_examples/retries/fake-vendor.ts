// A stand-in for the vendor's server, passed as `fetch`. It answers each
// request with the next entry and repeats the last one. An answer is a status
// code with an empty body, never a vendor payload.
export interface WithHeaders {
  readonly headers: Record<string, string>;
  readonly status: number;
}

export type Answer = number | "hang" | "offline" | WithHeaders;

const isStatus = (answer: number | WithHeaders): answer is number =>
  Number.isInteger(answer);

export interface FakeVendor {
  readonly fetch: typeof fetch;
  /** How many requests arrived. */
  readonly count: () => number;
}

// Like the real fetch: it settles only when the caller's signal aborts.
const hang = (signal: AbortSignal | null | undefined): Promise<Response> =>
  // oxlint-disable-next-line promise/avoid-new -- wraps an abort event.
  new Promise((_resolve, reject) => {
    signal?.addEventListener("abort", () => {
      reject(new DOMException("The operation was aborted", "AbortError"));
    });
  });

export const fakeVendor = (...answers: readonly Answer[]): FakeVendor => {
  let requests = 0;

  return {
    count: () => requests,
    fetch: (_input, init) => {
      const answer = answers[Math.min(requests, answers.length - 1)] ?? 200;

      requests += 1;

      if (answer === "hang") {
        return hang(init?.signal);
      }

      if (answer === "offline") {
        return Promise.reject(new TypeError("fetch failed"));
      }

      return Promise.resolve(
        isStatus(answer)
          ? new Response(null, { status: answer })
          : new Response(null, answer)
      );
    },
  };
};
