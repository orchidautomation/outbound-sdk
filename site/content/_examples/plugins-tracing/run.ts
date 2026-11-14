import { createOutbound, OutboundError } from "outbound-sdk";
import { instantly } from "outbound-sdk/instantly";
import { memory } from "outbound-sdk/memory";
import { tracing } from "outbound-sdk/tracing";
import type { SpanLike, TracerLike } from "outbound-sdk/tracing";

import { documentedFetch } from "../plugins-budget/documented-fetch.ts";

// In production pass `trace.getTracer("outbound")` from @opentelemetry/api.
// This stand-in prints each span when it ends, to show what the plugin emits.
const tracer: TracerLike = {
  startSpan: (name, options): SpanLike => {
    const attributes = new Map(Object.entries(options?.attributes ?? {}));

    let status = "unset";

    return {
      end: () => {
        console.log(`${name} [${status}]`, Object.fromEntries(attributes));
      },
      setAttribute: (key, value) => {
        attributes.set(key, value);
      },
      setStatus: ({ code }) => {
        status = code === 1 ? "ok" : "error";
      },
    };
  },
};

// Instantly's adapter on a fetch that serves the vendor's documented
// payloads from disk: one operation span and one HTTP span.
const vendor = createOutbound({
  adapter: instantly({ workspaceId: "acme" }),
  fetch: documentedFetch,
  plugins: [tracing({ tracer })],
});

await vendor.senders.list();

// A failed operation ends its span with the error code. The in-memory
// adapter makes no HTTP request, so there is no HTTP span here.
const local = createOutbound({
  adapter: memory({ workspaceId: "agency" }),
  plugins: [tracing({ tracer })],
});

try {
  await local.campaigns.get("cmp_missing");
} catch (error) {
  if (!OutboundError.is(error)) {
    throw error;
  }
}
