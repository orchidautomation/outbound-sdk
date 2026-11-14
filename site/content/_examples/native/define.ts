import { createOutbound, defineNative } from "outbound-sdk";
import type { Adapter } from "outbound-sdk";
import { memory } from "outbound-sdk/memory";

// A catalog for a made-up vendor. `defineNative` keeps each name and each
// parameter as a literal type, so callers get them checked and completed.
const NATIVE = defineNative({
  leadNotes: {
    description: "Notes written on one lead.",
    docs: "https://docs.mytool.example/lead-notes",
    method: "GET",
    params: {
      // A path parameter is always required.
      leadId: { description: "The lead.", in: "path", type: "string" },
      owners: { description: "Only these owners.", in: "query", type: "list" },
      since: {
        description: "Only notes from this day on.",
        in: "query",
        required: true,
        type: "string",
      },
    },
    path: "/leads/{leadId}/notes",
  },
  unreadCount: {
    description: "How many replies are unread.",
    method: "GET",
    path: "/inbox/unread-count",
  },
});

// The rest of the adapter is borrowed from the in-memory one to keep this
// short. A real adapter supplies its own reads; see the repository's
// docs/new-adapter.md.
const adapter: Adapter<typeof NATIVE> = {
  ...memory({ capabilities: { native: true }, name: "mytool" }),
  native: NATIVE,
  raw: {
    authorize: (spec) => ({
      ...spec,
      headers: { ...spec.headers, authorization: "Bearer not-a-real-key" },
    }),
    baseUrl: "https://api.mytool.example/v1",
    isRead: (method) => method === "GET",
  },
};

const outbound = createOutbound({
  adapter,
  // Stands in for the vendor and echoes the URL it was asked for.
  fetch: (input) => Promise.resolve(Response.json({ asked: String(input) })),
});

const notes = await outbound.native.reads.leadNotes({
  leadId: "lead 42",
  owners: ["ana", "ben"],
  since: "2026-11-01",
});

console.log(notes.data);

// A read with no required parameter can be called with none.
const unread = await outbound.native.reads.unreadCount();

console.log(unread.data, unread.meta.provider, unread.meta.requests);
