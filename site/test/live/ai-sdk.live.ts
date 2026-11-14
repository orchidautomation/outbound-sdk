// Runs the AI SDK samples against a real model through the Vercel AI
// Gateway. Not part of `npm test`: it costs money and needs a credential.
//
//   vercel env pull   # in site/, once linked: writes VERCEL_OIDC_TOKEN
//   set -a && . site/.env.local && set +a
//   npm run site:live
//
// AI_GATEWAY_API_KEY works in place of the OIDC token. The outbound side is
// the in-memory adapter, so the run proves the model calling the tools, not
// a vendor. RECORD_LIVE=1 rewrites the transcripts the pages show.

import assert from "node:assert/strict";
import { writeFileSync } from "node:fs";
import path from "node:path";
import { test } from "node:test";

import { createOutbound } from "outbound-sdk";
import { demoData, memory } from "outbound-sdk/memory";

import { ask as askGuide } from "../../content/_examples/agent-tools/ai-sdk.ts";
import { ask } from "../../content/_examples/tools-ai-sdk/generate.ts";

const MODEL = process.env.LIVE_MODEL ?? "deepseek/deepseek-v4-flash";

const skip =
  process.env.EXAMPLES_LIVE !== "1" ||
  !(process.env.VERCEL_OIDC_TOKEN || process.env.AI_GATEWAY_API_KEY);

const EXAMPLES = path.resolve(import.meta.dirname, "../../content/_examples");

type Run = Awaited<ReturnType<typeof ask>>;

/** What the page shows: the question, each tool call and the answer. */
const transcript = (prompt: string, run: Run) => ({
  answer: run.text,
  model: MODEL,
  prompt,
  ranAt: new Date().toISOString().slice(0, 10),
  steps: run.steps.length,
  toolCalls: run.steps.flatMap((step) =>
    step.toolCalls.map((call) => ({ input: call.input, tool: call.toolName }))
  ),
  via: "Vercel AI Gateway",
});

const record = (file: string, value: unknown): void => {
  if (process.env.RECORD_LIVE === "1") {
    writeFileSync(
      path.join(EXAMPLES, file),
      `${JSON.stringify(value, null, 2)}\n`
    );
  }
};

test(
  "a real model calls an outbound tool through the AI SDK and answers from it",
  { skip, timeout: 120_000 },
  async () => {
    const outbound = createOutbound({ adapter: memory({ data: demoData() }) });

    const prompt =
      "Which campaigns are active, and how many sends and replies has each had?";

    const run = await ask(outbound, MODEL, prompt);
    const result = transcript(prompt, run);

    record("tools-ai-sdk/live-run.json", result);
    assert.ok(result.toolCalls.length > 0, "the model called a tool");
    assert.match(
      result.answer,
      /Q4 SaaS founders/u,
      "it answered from the tool's result"
    );
  }
);

test(
  "the guide's agent, with the insight tools, answers a question that needs one",
  { skip, timeout: 120_000 },
  async () => {
    const prompt =
      "Rank the campaigns by reply rate. Which one is best, and what is its rate?";

    const run = await askGuide(MODEL, prompt);
    const result = transcript(prompt, run);

    record("agent-tools/live-run.json", result);
    assert.ok(result.toolCalls.length > 0, "the model called a tool");
    assert.ok(result.answer.length > 0, "it answered");
  }
);
