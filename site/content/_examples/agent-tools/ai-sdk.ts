import { generateText, stepCountIs } from "ai";
import type { LanguageModel } from "ai";
import { aiSdkTools } from "outbound-sdk/tools/ai-sdk";

import { extra, outbound } from "./outbound.ts";

// One AI SDK tool per outbound tool, keyed by name. Each has `execute`, so
// the AI SDK runs the calls itself.
const tools = aiSdkTools(outbound, { extra });

/**
 * Wiring only: this function is not called by the sample, because calling it
 * needs a model and a key. `model` is whatever your provider package gives.
 */
export const ask = (model: LanguageModel, prompt: string) =>
  generateText({ model, prompt, stopWhen: stepCountIs(8), tools });
