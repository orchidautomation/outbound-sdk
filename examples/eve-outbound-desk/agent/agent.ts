import { defineAgent } from "eve";

export default defineAgent({
  model: "anthropic/claude-sonnet-5",
  limits: {
    // A question about campaigns is a few tool calls. Ask before one thread
    // spends more than this, so a runaway loop can't burn the budget.
    sessionUsage: ({ window }) =>
      window.inputTokens - window.cacheReadTokens >= 400_000 ||
      (window.costUsd ?? 0) >= 2,
  },
});
