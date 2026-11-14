// outbound-sdk/tracing: emits OpenTelemetry spans, one per SDK operation and
// one per HTTP request. Pass a tracer from `@opentelemetry/api`; the plugin
// is written against the small part of that interface it uses, so the
// package does not depend on OpenTelemetry.

import { OutboundError } from "../internal/errors.ts";
import type { OutboundPlugin } from "../internal/outbound/plugins.ts";

export type SpanAttributes = Readonly<
  Record<string, string | number | boolean>
>;

/** The part of an OpenTelemetry `Span` this plugin uses. */
export interface SpanLike {
  readonly setAttribute: (
    key: string,
    value: string | number | boolean
  ) => void;
  readonly setStatus: (status: {
    readonly code: number;
    readonly message?: string;
  }) => void;
  readonly end: (endTime?: number) => void;
}

/** The part of an OpenTelemetry `Tracer` this plugin uses. */
export interface TracerLike {
  readonly startSpan: (
    name: string,
    options?: {
      readonly attributes?: SpanAttributes;
      readonly startTime?: number;
    }
  ) => SpanLike;
}

export interface TracingOptions {
  readonly tracer: TracerLike;
  /** The clock, for tests. */
  readonly now?: (() => number) | undefined;
}

// OpenTelemetry's SpanStatusCode values.
const OK = 1;
const ERROR = 2;

/** Emits a span per operation and per HTTP request. */
export const tracing = (options: TracingOptions): OutboundPlugin => {
  const { tracer } = options;
  const now = options.now ?? (() => Date.now());

  return {
    hooks: {
      // The request has already finished when the hook fires, so the span is
      // created with the time it started.
      onRequest: (event) => {
        const span = tracer.startSpan(`outbound.http ${event.method}`, {
          attributes: {
            "http.request.method": event.method,
            "outbound.attempt": event.attempt,
            "outbound.lane": event.lane,
            "outbound.provider": event.provider,
            "url.full": event.url,
            ...(event.status === null
              ? undefined
              : { "http.response.status_code": event.status }),
          },
          startTime: now() - event.durationMs,
        });

        span.setStatus({
          code: event.status !== null && event.status < 400 ? OK : ERROR,
        });
        span.end();
      },
    },
    name: "tracing",
    wrap: async (operation, next, info) => {
      const span = tracer.startSpan(`outbound.${operation.kind}`, {
        attributes: {
          "outbound.operation": operation.kind,
          "outbound.provider": info.provider,
          "outbound.workspace": info.workspaceId,
        },
      });

      const before = info.state.requests;

      try {
        const output = await next(operation);
        span.setAttribute("outbound.records", output.items.length);
        span.setAttribute("outbound.evidence", output.evidence);
        span.setStatus({ code: OK });

        return output;
      } catch (error) {
        span.setAttribute(
          "outbound.error",
          OutboundError.is(error) ? error.code : "Provider"
        );
        span.setStatus({
          code: ERROR,
          message: error instanceof Error ? error.message : String(error),
        });
        throw error;
      } finally {
        span.setAttribute("outbound.requests", info.state.requests - before);
        span.end();
      }
    },
  };
};
