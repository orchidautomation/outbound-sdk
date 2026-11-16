import { isJsonObject, isString } from "./json.ts";
import type { Json, JsonObject } from "./json.ts";
import { redactCause, redactText } from "./redact.ts";

export type OutboundErrorCode =
  | "Invalid"
  | "NotFound"
  | "Provider"
  | "RateLimited"
  | "Unauthorized"
  | "Unsupported";

/**
 * What stopped a `RateLimited` call.
 *
 * - `vendor`: the vendor answered 429 and the SDK's retries did not get past it.
 * - `deadline`: the SDK's own rate budget was full, and waiting for room
 *   would pass the call's `deadline`. No request was sent.
 * - `call`: the call reached its request cap (`maxRequests` on the call or on
 *   `createOutbound`, or `budget({ per: "call" })`).
 * - `run`: a `budget({ per: "run" })` has nothing left.
 *
 * `vendor` and `deadline` can work later. `call` and `run` are caps you set,
 * so the same call stops the same way until you raise or reset them.
 */
export type RequestLimit = "call" | "deadline" | "run" | "vendor";

/**
 * What a `listAll().toArray()` walk had fetched when it stopped. Resume with
 * `listAll({ cursor })`: no record is skipped or repeated.
 */
export interface PartialWalk {
  /** The records fetched before the stop, in order. */
  readonly items: readonly unknown[];
  /** Where to resume. `undefined` when no page was finished: start over. */
  readonly cursor: string | undefined;
  /** Vendor requests the walk made, including the one that failed. */
  readonly requests: number;
}

export interface OutboundErrorOptions {
  /**
   * The original error or vendor response, for debugging. It is kept as a
   * copy with secrets and email addresses removed, because loggers print the
   * cause chain.
   */
  readonly cause?: unknown;
  readonly provider?: string | undefined;
  /** The HTTP status that produced this error, when there was one. */
  readonly status?: number | undefined;
  /** How long the vendor asked us to wait. Set on `RateLimited`. */
  readonly retryAfterMs?: number | undefined;
  readonly aborted?: boolean | undefined;
  readonly timedOut?: boolean | undefined;
  /**
   * What stopped a `RateLimited` call. Defaults to `vendor` when there is an
   * HTTP status. A `call` or `run` cap makes the error permanent.
   */
  readonly limit?: RequestLimit | undefined;
  /** What a `toArray()` walk had fetched when it stopped. */
  readonly partial?: PartialWalk | undefined;
  /**
   * `true` when the same call fails the same way again, whatever the code:
   * for example a `Provider` error for a vendor record the SDK cannot read.
   */
  readonly permanent?: boolean | undefined;
  /** Secrets to strip from the message. */
  readonly secrets?: readonly string[] | undefined;
}

// A registered symbol, so `OutboundError.is()` works across bundled copies of
// the package where `instanceof` would compare two different classes.
const BRAND = Symbol.for("outbound-sdk.OutboundError");

const RETRYABLE: ReadonlySet<OutboundErrorCode> = new Set([
  "Provider",
  "RateLimited",
]);

/**
 * The one error class the SDK throws. Branch on `code`, never on a subclass.
 */
export class OutboundError extends Error {
  override readonly name = "OutboundError";
  readonly code: OutboundErrorCode;
  readonly provider: string | undefined;
  readonly status: number | undefined;
  readonly retryAfterMs: number | undefined;
  readonly aborted: boolean;
  readonly timedOut: boolean;
  /**
   * What stopped a `RateLimited` call: the vendor, a deadline, or a request
   * cap of your own. `undefined` on every other code.
   */
  readonly limit: RequestLimit | undefined;
  /**
   * Set when `listAll().toArray()` stopped part way: the records it had
   * fetched and the cursor to resume from. A partial answer is never returned
   * as if it were complete.
   */
  readonly partial: PartialWalk | undefined;
  /** `true` when retrying the same call cannot succeed. */
  readonly permanent: boolean;
  readonly [BRAND] = true;

  constructor(
    code: OutboundErrorCode,
    message: string,
    options: OutboundErrorOptions = {}
  ) {
    super(redactText(message, options.secrets), {
      cause: redactCause(options.cause, options.secrets),
    });
    this.code = code;
    this.provider = options.provider;
    this.status = options.status;
    this.retryAfterMs = options.retryAfterMs;
    this.aborted = options.aborted ?? false;
    this.timedOut = options.timedOut ?? false;
    this.limit =
      code === "RateLimited"
        ? (options.limit ??
          (options.status === undefined ? undefined : "vendor"))
        : undefined;
    this.partial = options.partial;
    // A cap the caller set stops the same call at the same place again.
    this.permanent =
      options.permanent === true ||
      this.aborted ||
      !RETRYABLE.has(code) ||
      this.limit === "call" ||
      this.limit === "run";
  }

  /** Type guard that also recognises errors from another copy of the package. */
  static is(cause: unknown): cause is OutboundError {
    return typeof cause === "object" && cause !== null && BRAND in cause;
  }
}

/** What the request engine hands an adapter's `mapError`. */
export interface HttpFailure {
  readonly status: number;
  readonly body: Json | undefined;
  readonly retryAfterMs: number | undefined;
}

export const isHttpFailure = (cause: unknown): cause is HttpFailure =>
  typeof cause === "object" &&
  cause !== null &&
  "status" in cause &&
  "body" in cause;

const codeForStatus = (status: number): OutboundErrorCode => {
  if (status === 401 || status === 403) {
    return "Unauthorized";
  }

  if (status === 404) {
    return "NotFound";
  }

  if (status === 429) {
    return "RateLimited";
  }

  if (status === 408 || status >= 500) {
    return "Provider";
  }

  return "Invalid";
};

const messageFromBody = (body: Json | undefined): string | null => {
  if (isString(body)) {
    return body.slice(0, 300);
  }

  if (!isJsonObject(body)) {
    return null;
  }

  for (const key of ["message", "error", "detail", "errorMessage"]) {
    const value = body[key];

    if (isString(value) && value !== "") {
      return value.slice(0, 300);
    }
  }

  return null;
};

export interface ErrorMapperOptions {
  readonly secrets?: readonly string[];
  /** Per-status overrides for vendors that use a status unconventionally. */
  readonly statusCodes?: Readonly<Record<number, OutboundErrorCode>>;
}

export type ErrorMapper = (cause: unknown) => OutboundError;

/**
 * Builds an adapter's `mapError`. HTTP failures map by status; anything else
 * becomes a retryable `Provider` error with the original kept in `cause`.
 */
export const makeErrorMapper =
  (provider: string, options: ErrorMapperOptions = {}): ErrorMapper =>
  (cause) => {
    if (OutboundError.is(cause)) {
      return cause;
    }

    const { secrets = [] } = options;

    if (isHttpFailure(cause)) {
      const code =
        options.statusCodes?.[cause.status] ?? codeForStatus(cause.status);

      const detail = messageFromBody(cause.body);

      return new OutboundError(
        code,
        `${provider} responded ${cause.status}${detail === null ? "" : `: ${detail}`}`,
        {
          cause,
          provider,
          secrets,
          retryAfterMs: cause.retryAfterMs,
          status: cause.status,
        }
      );
    }

    const detail = cause instanceof Error ? cause.message : String(cause);

    return new OutboundError(
      "Provider",
      `${provider} request failed: ${detail}`,
      {
        cause,
        provider,
        secrets,
      }
    );
  };

/**
 * A vendor response that must be one object. Anything else is the vendor's
 * fault, so it is a `Provider` error with the adapter's own message.
 */
export const requireObject = (
  body: Json | undefined,
  provider: string,
  message: string
): JsonObject => {
  if (!isJsonObject(body)) {
    throw new OutboundError("Provider", message, { provider });
  }

  return body;
};
