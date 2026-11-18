// Hooks observe calls without being able to fail them. Each one is
// fire-and-forget: a hook that throws or rejects is ignored.

export interface ActionEvent {
  /** The operation, for example `campaigns.list`. */
  readonly action: string;
  readonly provider: string;
  readonly workspaceId: string;
  readonly durationMs: number;
  /** Vendor requests the call made. */
  readonly requests: number;
  readonly throttledMs: number;
}

export interface ErrorEvent {
  readonly action: string;
  readonly provider: string;
  readonly workspaceId: string;
  readonly error: Error;
}

export interface RetryEvent {
  readonly provider: string;
  /** The attempt that failed, starting at 1. */
  readonly attempt: number;
  readonly delayMs: number;
  readonly reason: string;
  /** The request URL with secrets removed. */
  readonly url: string;
}

export interface ThrottleEvent {
  readonly provider: string;
  readonly lane: string;
  readonly waitMs: number;
  /**
   * `budget`: the SDK's own rate budget for the lane is full. `vendor`: the
   * vendor answered 429, often because another process or tool on the same
   * workspace spent the limit.
   */
  readonly cause: "budget" | "vendor";
  /** The windows the SDK keeps the lane inside, after `share` and any slowdown. */
  readonly windows: readonly {
    readonly requests: number;
    readonly perMs: number;
  }[];
  /** The vendor's published windows for the lane, before `share` and any slowdown. */
  readonly declared: readonly {
    readonly requests: number;
    readonly perMs: number;
  }[];
}

export interface RequestEvent {
  readonly provider: string;
  readonly method: string;
  /** The request URL with secrets removed. */
  readonly url: string;
  readonly lane: string;
  /** The HTTP status, or `null` when no response arrived. */
  readonly status: number | null;
  readonly durationMs: number;
  /** Which attempt this was, starting at 1. */
  readonly attempt: number;
}

type Hook<Event> = (event: Event) => void | Promise<void>;

export interface OutboundHooks {
  readonly onAction?: Hook<ActionEvent> | undefined;
  readonly onError?: Hook<ErrorEvent> | undefined;
  /** Fires once per HTTP request, after it settles. */
  readonly onRequest?: Hook<RequestEvent> | undefined;
  readonly onRetry?: Hook<RetryEvent> | undefined;
  readonly onThrottle?: Hook<ThrottleEvent> | undefined;
}

const ignore = (): void => {
  // A failing hook must never fail the call it observes.
};

export const fire = <Event>(
  hook: Hook<Event> | undefined,
  event: Event
): void => {
  if (hook === undefined) {
    return;
  }

  try {
    // oxlint-disable-next-line promise/prefer-await-to-then -- fire-and-forget by design.
    Promise.resolve(hook(event)).catch(ignore);
  } catch {
    ignore();
  }
};

/** One set of hooks that calls every set given, in order. */
export const mergeHooks = (
  all: readonly (OutboundHooks | undefined)[]
): OutboundHooks => {
  const defined = all.filter((hooks) => hooks !== undefined);

  return {
    onAction: (event) => {
      for (const hooks of defined) {
        fire(hooks.onAction, event);
      }
    },
    onError: (event) => {
      for (const hooks of defined) {
        fire(hooks.onError, event);
      }
    },
    onRequest: (event) => {
      for (const hooks of defined) {
        fire(hooks.onRequest, event);
      }
    },
    onRetry: (event) => {
      for (const hooks of defined) {
        fire(hooks.onRetry, event);
      }
    },
    onThrottle: (event) => {
      for (const hooks of defined) {
        fire(hooks.onThrottle, event);
      }
    },
  };
};
