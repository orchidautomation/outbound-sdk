// How an adapter describes its vendor's rate limits. The request engine keeps
// every request inside every declared window.

export interface RateWindow {
  /** Requests allowed in the window. */
  readonly requests: number;
  /** Window length in milliseconds. */
  readonly perMs: number;
}

export interface RateLimitHeaders {
  /** Header holding the requests left in the current window. */
  readonly remaining?: string | undefined;
  /** Header holding when the window resets. */
  readonly reset?: string | undefined;
  /** How to read `reset`: seconds until reset, or an epoch in seconds. */
  readonly resetUnit?: "epoch-seconds" | "seconds" | undefined;
}

export interface LimitDeclaration {
  /** The vendor's published limits. A request must fit every window. */
  readonly windows: readonly RateWindow[];
  /** Requests in flight at once for one credential. Defaults to 8. */
  readonly concurrency?: number | undefined;
  /** Endpoints with their own stricter cap, on top of `windows`. */
  readonly lanes?: Readonly<Record<string, readonly RateWindow[]>> | undefined;
  /** Rate-limit headers the vendor sends, when it sends any. */
  readonly headers?: RateLimitHeaders | undefined;
  /** Where the numbers came from, and whether they were confirmed. */
  readonly source: string;
}

export const DEFAULT_CONCURRENCY = 8;

/**
 * The fraction of a vendor's published limit the SDK uses by default. The
 * limit is shared with the customer's other tools, so we leave room for them.
 */
export const DEFAULT_SHARE = 0.5;

/** Scales a window by `share`, never below one request. */
export const scaleWindow = (window: RateWindow, share: number): RateWindow => ({
  perMs: window.perMs,
  requests: Math.max(1, Math.floor(window.requests * share)),
});
