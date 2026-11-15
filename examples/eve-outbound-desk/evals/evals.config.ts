import { defineEvalConfig } from "eve/evals";

// The evals run on the demo data in agent/lib/demo.ts: `npm run eval` sets
// OUTBOUND_SDK_PROVIDER=memory, so no vendor key is needed, only a model key.
export default defineEvalConfig({
  timeoutMs: 180_000,
});
