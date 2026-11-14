import { outbound, outboundSummary } from "./cli.ts";

// The in-memory adapter has no vendor behind it, so no reads of its own.
await outbound("native");

await outbound("native", "inboxUnreadCount");

// A real adapter lists its catalog without making a request.
await outboundSummary(["native", "--provider", "instantly"], (text) => {
  const reads = Object.keys(JSON.parse(text));

  return `a JSON object of ${reads.length} reads, keyed by name, each with description, docs, method, path and params. The first three: ${reads.slice(0, 3).join(", ")}`;
});
