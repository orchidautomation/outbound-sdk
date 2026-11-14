import { generateText, stepCountIs } from "ai";
import type { LanguageModel } from "ai";
import type { OutboundApi } from "outbound-sdk";
import { aiSdkTools } from "outbound-sdk/tools/ai-sdk";

/**
 * Asks a model a question about `outbound`. The model may call the tools,
 * read what they return and answer, in up to five steps.
 */
export const ask = (
  outbound: OutboundApi,
  model: LanguageModel,
  prompt: string
) =>
  generateText({
    model,
    prompt,
    stopWhen: stepCountIs(5),
    tools: aiSdkTools(outbound),
  });
