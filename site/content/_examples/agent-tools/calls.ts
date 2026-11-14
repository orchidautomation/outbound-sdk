import { openaiTools } from "outbound-sdk/tools";

import { extra, outbound } from "./outbound.ts";

const { chatTools, handle, tools } = openaiTools(outbound, { extra });

// `tools` goes to the Responses API, `chatTools` to Chat Completions.
console.log(tools.length, "tools;", "the first one:");

console.log(JSON.stringify({ ...tools[0], parameters: "(JSON Schema)" }));

console.log(Object.keys(chatTools[0] ?? {}).join(", "));

// What your loop does with a function call from the model: pass the name and
// the arguments string to `handle`, and send the string it returns back.
const show = async (name: string, argumentsJson: string): Promise<void> => {
  const output = await handle(name, argumentsJson);

  console.log(`\n${name} ${argumentsJson}`);
  console.log(JSON.stringify(JSON.parse(output), null, 2));
};

await show("winning_steps", '{"campaign":"cmp_founders"}');

await show("campaign_ranking", '{"metric":"reply_rate"}');
