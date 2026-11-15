// One request, with the rate budget, the per-attempt timeout and retries
// around it. Every call is a read, so a timed-out attempt is safe to repeat.

import type { Adapter, RequestSpec, VendorResponse } from "../adapter.ts";
import { OutboundError } from "../errors.ts";
import type { HttpFailure } from "../errors.ts";
import { fire } from "../hooks.ts";
import type { OutboundHooks } from "../hooks.ts";
import { count, parseJson } from "../json.ts";
import type { Json } from "../json.ts";
import { plural } from "../plural.ts";
import { redactUrl } from "../redact.ts";
import { DEFAULT_LANE } from "./budget.ts";
import type { Budget } from "./budget.ts";
import { isRetryableStatus, parseRetryAfter } from "./retry.ts";
import type { RetryPolicy } from "./retry.ts";
import { abortedError, sleep } from "./runtime.ts";
import type { Runtime } from "./runtime.ts";

export const DEFAULT_TIMEOUT_MS = 30_000;

/** What one SDK call has used so far. Shared by every request it makes. */
export interface CallState {
  requests: number;
  throttledMs: number;
  readonly signal: AbortSignal | undefined;
  readonly timeoutMs: number;
  readonly retry: RetryPolicy;
  /** An epoch in milliseconds: the total budget across retries and waits. */
  readonly deadlineAt: number | undefined;
  /** Stop after this many vendor requests. A plugin may lower it. */
  maxRequests: number | undefined;
  /**
   * The setting to raise when `maxRequests` stops the call, named in the
   * error. Defaults to "maxRequests". A plugin that lowers the cap sets it.
   */
  maxRequestsSetBy: string | undefined;
  /**
   * Runs as each vendor request is about to be sent, after any wait, with no
   * other request able to slip in between. A plugin that caps requests across
   * calls counts the request here, or throws to stop it. A plugin chains onto
   * the one already set.
   */
  beforeRequest: (() => void) | undefined;
}

export interface RequestEnvironment {
  readonly adapter: Adapter;
  readonly budget: Budget;
  readonly runtime: Runtime;
  readonly hooks: OutboundHooks;
  readonly state: CallState;
}

type Attempt =
  | { readonly kind: "ok"; readonly response: VendorResponse }
  | {
      readonly kind: "retry";
      readonly error: OutboundError;
      readonly retryAfterMs?: number;
    };

const TIMED_OUT = Symbol("timed-out");

const readBody = async (response: Response): Promise<Json> => {
  const raw = await response.text();

  if (raw === "") {
    return null;
  }

  return parseJson(raw) ?? raw;
};

const fetchOnce = async (
  spec: RequestSpec,
  environment: RequestEnvironment
): Promise<Response> => {
  const { runtime, state } = environment;
  const controller = new AbortController();

  const onCallerAbort = (): void => {
    controller.abort();
  };

  let timedOut = false;

  const cancelTimer = runtime.timer(state.timeoutMs, () => {
    timedOut = true;
    controller.abort();
  });

  state.signal?.addEventListener("abort", onCallerAbort, { once: true });

  try {
    return await runtime.fetch(spec.url, {
      headers: {
        accept: "application/json",
        ...(spec.body === undefined
          ? undefined
          : { "content-type": "application/json" }),
        ...spec.headers,
      },
      method: spec.method,
      signal: controller.signal,
      ...(spec.body === undefined
        ? undefined
        : { body: JSON.stringify(spec.body) }),
    });
  } catch (error) {
    throw timedOut ? TIMED_OUT : error;
  } finally {
    cancelTimer();
    state.signal?.removeEventListener("abort", onCallerAbort);
  }
};

const noteHeaders = async (
  response: Response,
  environment: RequestEnvironment
): Promise<void> => {
  const { adapter, budget, runtime } = environment;
  const names = adapter.limits.headers;

  if (names?.remaining === undefined || names.reset === undefined) {
    return;
  }

  const remaining = count(response.headers.get(names.remaining));
  const reset = count(response.headers.get(names.reset));

  if (remaining === null || reset === null || remaining > 0) {
    return;
  }

  const now = runtime.now();

  const resetInMs =
    names.resetUnit === "epoch-seconds" ? reset * 1000 - now : reset * 1000;

  if (resetInMs > 0) {
    await budget.exhausted(resetInMs, now);
  }
};

const failureFor = async (
  response: Response,
  body: Json,
  spec: RequestSpec,
  environment: RequestEnvironment
): Promise<Attempt> => {
  const { adapter, budget, runtime } = environment;
  const now = runtime.now();
  const retryAfterMs = parseRetryAfter(response.headers, body, now);
  const failure: HttpFailure = { body, retryAfterMs, status: response.status };
  const error = adapter.mapError(failure);

  if (response.status === 429) {
    await budget.rateLimited(
      spec.lane ?? DEFAULT_LANE,
      retryAfterMs ?? 1000,
      now
    );
  }

  if (!isRetryableStatus(response.status)) {
    throw error;
  }

  return retryAfterMs === undefined
    ? { error, kind: "retry" }
    : { error, kind: "retry", retryAfterMs };
};

const attempt = async (
  spec: RequestSpec,
  environment: RequestEnvironment,
  attemptNumber: number
): Promise<Attempt> => {
  const { adapter, budget, hooks, runtime, state } = environment;
  const lane = spec.lane ?? DEFAULT_LANE;

  state.throttledMs += await budget.acquire({
    deadlineAt: state.deadlineAt,
    hooks,
    lane,
    runtime,
    signal: state.signal,
  });

  // Checked again after the wait: requests of the same call, or of the same
  // run, may have used the allowance while this one waited.
  try {
    assertRequestBudget(environment);
    state.beforeRequest?.();
  } catch (error) {
    budget.release();
    throw error;
  }

  state.requests += 1;
  const startedAt = runtime.now();
  let status: number | null = null;

  try {
    const response = await fetchOnce(spec, environment);
    ({ status } = response);
    const body = await readBody(response);
    await noteHeaders(response, environment);

    if (response.ok) {
      budget.succeeded();

      return {
        kind: "ok",
        response: { body, headers: response.headers, status: response.status },
      };
    }

    return await failureFor(response, body, spec, environment);
  } catch (error) {
    if (OutboundError.is(error)) {
      throw error;
    }

    if (state.signal?.aborted) {
      throw abortedError(adapter.name);
    }

    const timedOut = error === TIMED_OUT;

    const message = timedOut
      ? `${adapter.name} did not answer within ${state.timeoutMs} ms`
      : `${adapter.name} request failed: ${error instanceof Error ? error.message : String(error)}`;

    return {
      error: new OutboundError("Provider", message, {
        cause: timedOut ? undefined : error,
        provider: adapter.name,
        secrets: adapter.secrets,
        timedOut,
      }),
      kind: "retry",
    };
  } finally {
    budget.release();
    fire(hooks.onRequest, {
      attempt: attemptNumber,
      durationMs: runtime.now() - startedAt,
      lane,
      method: spec.method,
      provider: adapter.name,
      status,
      url: redactUrl(spec.url, adapter.secrets),
    });
  }
};

const assertRequestBudget = (environment: RequestEnvironment): void => {
  const { adapter, state } = environment;

  if (state.maxRequests !== undefined && state.requests >= state.maxRequests) {
    const setBy = state.maxRequestsSetBy ?? "maxRequests";

    throw new OutboundError(
      "RateLimited",
      `The call used its budget of ${plural(state.maxRequests, "request")} to ${adapter.name}. Raise ${setBy} or ask for less in one call.`,
      { limit: "call", provider: adapter.name }
    );
  }
};

const exhausted = (error: OutboundError, timedOut: boolean): OutboundError =>
  timedOut
    ? new OutboundError(error.code, error.message, {
        cause: error.cause,
        limit: error.limit,
        provider: error.provider,
        retryAfterMs: error.retryAfterMs,
        status: error.status,
        timedOut: true,
      })
    : error;

/** Sends one request, retrying what is safe to retry. */
export const execute = async (
  spec: RequestSpec,
  environment: RequestEnvironment
): Promise<VendorResponse> => {
  const { adapter, hooks, runtime, state } = environment;

  for (let attemptNumber = 1; ; attemptNumber += 1) {
    assertRequestBudget(environment);
    // oxlint-disable-next-line no-await-in-loop -- attempts are sequential by definition.
    const result = await attempt(spec, environment, attemptNumber);

    if (result.kind === "ok") {
      return result.response;
    }

    if (attemptNumber > state.retry.max) {
      throw result.error;
    }

    const backoff = state.retry.backoff(attemptNumber, runtime.random());
    const delayMs = Math.max(result.retryAfterMs ?? 0, backoff);

    if (
      state.deadlineAt !== undefined &&
      runtime.now() + delayMs > state.deadlineAt
    ) {
      throw exhausted(result.error, true);
    }

    fire(hooks.onRetry, {
      attempt: attemptNumber,
      delayMs,
      provider: adapter.name,
      reason: result.error.message,
      url: redactUrl(spec.url, adapter.secrets),
    });
    // oxlint-disable-next-line no-await-in-loop -- the delay separates attempts.
    await sleep(runtime, delayMs, adapter.name, state.signal);
  }
};
