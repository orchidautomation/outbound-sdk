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
}

type Hook<Event> = (event: Event) => void | Promise<void>;

export interface OutboundHooks {
  readonly onAction?: Hook<ActionEvent> | undefined;
  readonly onError?: Hook<ErrorEvent> | undefined;
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
