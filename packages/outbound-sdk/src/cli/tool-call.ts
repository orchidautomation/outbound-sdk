// What one MCP tool call may spend in time, and how it is stopped. An agent
// host gives up on a tool call after a minute or so and keeps nothing, so a
// call that would run longer, waiting on a slow vendor lane, stops at its
// time budget and answers with what it read. While it runs, a client that
// asked for progress hears how far it is, and a call the client cancels
// stops and is not answered.

import { AsyncLocalStorage } from "node:async_hooks";

import { stoppedByDeadline } from "../internal/engine/request.ts";
import { defaultRuntime } from "../internal/engine/runtime.ts";
import type { Runtime } from "../internal/engine/runtime.ts";
import { OutboundError } from "../internal/errors.ts";
import type { Json, JsonObject } from "../internal/json.ts";
import { isNumber, isString } from "../internal/json.ts";
import type { OutboundApi } from "../internal/outbound/api.ts";
import type { OutboundPlugin } from "../internal/outbound/plugins.ts";
import { cappedAccess } from "../internal/request-cap.ts";
import type { ThrottleTotal } from "./progress.ts";

/**
 * How long one tool call may take by default: under the 60 s most agent
 * hosts wait for a tool call, with room for the answer to arrive.
 */
export const DEFAULT_TIME_BUDGET_MS = 50_000;

/**
 * How long a call that was stopped may take to wind down before it is
 * answered without it, as a tool that reads past the scope would need.
 */
export const LATE_AFTER_MS = 5000;

/** How often a client that sent a `progressToken` hears from a call still running. */
export const PROGRESS_EVERY_MS = 5000;

/** One tool call under way. */
interface ToolCall {
  /** Aborts when the budget runs out or the client cancels the call. */
  readonly signal: AbortSignal;
  /** An epoch in milliseconds: when the budget runs out. */
  readonly deadlineAt: number | undefined;
  /** `true` once the budget ran out. */
  readonly expired: () => boolean;
  /** Why a read of this call stopped, in words a model can act on. */
  readonly stopMessage: string;
}

export interface ToolCallScope {
  /** `outbound` with every SDK call a tool call makes held to that call's budget. */
  readonly over: (outbound: OutboundApi) => OutboundApi;
  readonly current: AsyncLocalStorage<ToolCall>;
}

// A read the budget stopped fails as a cap of the caller's own, so an
// insight keeps what it read instead of throwing it away.
const timeStop = (
  call: ToolCall,
  error: OutboundError,
  provider: string
): OutboundError =>
  new OutboundError("RateLimited", call.stopMessage, {
    cause: error,
    limit: "call",
    partial: error.partial,
    permanent: true,
    provider,
  });

// The budget ran out, or the engine saw a wait that would pass it. A
// cancelled call keeps its own abort error.
const ranOut = (call: ToolCall, error: unknown): error is OutboundError =>
  OutboundError.is(error) &&
  error.limit !== "call" &&
  (call.expired() || stoppedByDeadline(error));

/**
 * The scope tool calls run in. Its layer gives each SDK call the tool call's
 * deadline and signal, so a throttle wait that would pass the deadline stops
 * at once, and a read the budget stopped fails with `RateLimited`, `limit`
 * "call", which an insight answers around with `complete: false` and a note.
 */
export const toolCallScope = (): ToolCallScope => {
  const current = new AsyncLocalStorage<ToolCall>();
  const seen = new WeakSet<object>();

  const layer: OutboundPlugin = {
    name: "tool call",
    wrap: async (operation, next, info) => {
      const call = current.getStore();

      if (call === undefined) {
        return await next(operation);
      }

      const { state } = info;

      if (!seen.has(state)) {
        seen.add(state);
        state.signal =
          state.signal === undefined
            ? call.signal
            : AbortSignal.any([state.signal, call.signal]);

        if (call.deadlineAt !== undefined) {
          state.deadlineAt = Math.min(
            state.deadlineAt ?? Number.POSITIVE_INFINITY,
            call.deadlineAt
          );
        }
      }

      try {
        return await next(operation);
      } catch (error) {
        throw ranOut(call, error)
          ? timeStop(call, error, info.provider)
          : error;
      }
    },
  };

  return {
    current,
    over: (outbound) => cappedAccess(outbound)?.guarded(layer) ?? outbound,
  };
};

export type RequestId = number | string;

export interface CallsOptions {
  readonly scope: ToolCallScope;
  /** Milliseconds a call may take, from when it arrives; `Infinity` for no limit. */
  readonly timeBudgetMs: number;
  /** What to raise for a longer budget, named when a call stops at it. */
  readonly timeBudgetSetting: string;
  readonly throttled?: (() => ThrottleTotal) | undefined;
  readonly runtime?: Partial<Pick<Runtime, "now" | "timer">> | undefined;
}

export interface Calls {
  /**
   * Runs one tool call after the calls before it, within its time budget,
   * telling `notify` how it goes when the client sent `progressToken`.
   * Resolves to `undefined` when the client cancelled it.
   */
  readonly run: <Result>(request: {
    readonly id: RequestId;
    readonly name: string;
    readonly progressToken: Json | undefined;
    readonly notify: ((message: JsonObject) => void) | undefined;
    readonly body: () => Promise<Result>;
    /**
     * The answer when `body` has not finished `LATE_AFTER_MS` after the
     * budget ran out, given the stop message: a tool whose reads do not go
     * through the scope keeps running, and the calls after it go on.
     */
    readonly late: (message: string) => Result;
  }) => Promise<Result | undefined>;
  /** Stops the call with this id, queued or running, and drops its answer. */
  readonly cancel: (id: RequestId) => void;
}

const secondsOf = (ms: number): number => Math.round(ms / 1000);

/** What stopping does when there is nothing to stop. */
const nothing = (): undefined => undefined;

// How far a call is, and how much of that it spent waiting on rate limits.
const progressMessage = (
  elapsed: number,
  waitedBefore: number,
  throttle: ThrottleTotal | undefined
): string => {
  const waited = (throttle?.ms ?? 0) - waitedBefore;

  return waited >= 1000
    ? `${secondsOf(elapsed)}s in, ${secondsOf(waited)}s of it waiting on rate limits. Last wait: ${throttle?.reason ?? "unknown"}`
    : `${secondsOf(elapsed)}s in, still reading.`;
};

/** Tool calls one at a time, each within its time budget and cancellable. */
export const toolCalls = (options: CallsOptions): Calls => {
  const { scope, timeBudgetMs, timeBudgetSetting } = options;
  const clock = { ...defaultRuntime, ...options.runtime };
  const limited = Number.isFinite(timeBudgetMs);
  const running = new Map<RequestId, AbortController>();
  // One call at a time, as before, so each call's request cap and its
  // throttle time are its own. ping and cancel are answered meanwhile.
  let queue: Promise<unknown> = Promise.resolve();

  const progress = (
    token: Json | undefined,
    notify: ((message: JsonObject) => void) | undefined,
    startedAt: number
  ): (() => void) => {
    if (notify === undefined || !(isString(token) || isNumber(token))) {
      return nothing;
    }

    const waitedBefore = options.throttled?.().ms ?? 0;
    let stop: () => void = nothing;

    const tick = (): void => {
      const elapsed = clock.now() - startedAt;

      // Progress has to rise and stay under the total, so it stops at the budget.
      if (limited && elapsed >= timeBudgetMs) {
        return;
      }

      const params: JsonObject = {
        message: progressMessage(elapsed, waitedBefore, options.throttled?.()),
        progress: secondsOf(elapsed),
        progressToken: token,
      };

      if (limited) {
        params.total = secondsOf(timeBudgetMs);
      }

      notify({ jsonrpc: "2.0", method: "notifications/progress", params });

      stop = clock.timer(PROGRESS_EVERY_MS, tick);
    };

    stop = clock.timer(PROGRESS_EVERY_MS, tick);

    return () => {
      stop();
    };
  };

  return {
    cancel: (id) => {
      running.get(id)?.abort();
    },
    run: async ({ body, id, late, name, notify, progressToken }) => {
      const controller = new AbortController();
      const startedAt = clock.now();
      let expired = false;
      let stopLate: () => void = nothing;
      let giveUp: () => void = nothing;

      // oxlint-disable-next-line promise/avoid-new -- settled by a timer once the call was stopped.
      const lateAnswer = new Promise<ReturnType<typeof late> | undefined>(
        (resolve) => {
          giveUp = () => {
            resolve(expired ? late(call.stopMessage) : undefined);
          };
        }
      );

      controller.signal.addEventListener(
        "abort",
        () => {
          stopLate = clock.timer(LATE_AFTER_MS, giveUp);
        },
        { once: true }
      );

      running.set(id, controller);

      const stopTimer = limited
        ? clock.timer(timeBudgetMs, () => {
            expired = true;
            controller.abort();
          })
        : nothing;

      const stopProgress = progress(progressToken, notify, startedAt);

      const call: ToolCall = {
        deadlineAt: limited ? startedAt + timeBudgetMs : undefined,
        expired: () => expired,
        signal: controller.signal,
        stopMessage: `${name} stopped at its time budget of ${secondsOf(timeBudgetMs)}s: what it had not read would not have been read in time, so the answer leaves it out. Call it again with less to read, such as fewer campaigns or a shorter range, or raise ${timeBudgetSetting} and the client's tool timeout with it.`,
      };

      const turn = Promise.race([
        queue.then(async () =>
          controller.signal.aborted && !expired
            ? undefined
            : await scope.current.run(call, body)
        ),
        lateAnswer,
      ]);

      queue = turn.catch(nothing);

      try {
        const answer = await turn;

        return controller.signal.aborted && !expired ? undefined : answer;
      } finally {
        stopTimer();
        stopLate();
        stopProgress();
        running.delete(id);
      }
    },
  };
};
