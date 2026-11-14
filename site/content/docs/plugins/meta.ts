import { defineMeta } from "blume";

export default defineMeta({
  pages: [
    // Several tools, several clients.
    "clients",
    "identity",
    "redact",
    // Cost and visibility.
    "cache",
    "budget",
    "audit",
    "tracing",
    // Keeping a copy in step.
    "sync",
    "reconcile",
    "alerts",
    // Context, files and bad days.
    "benchmarks",
    "fixtures",
    "exporter",
    "failover",
    "writing-a-plugin",
  ],
  title: "Plugins",
});
