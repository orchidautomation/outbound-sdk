import { createOutbound } from "outbound-sdk";
import { insightTools } from "outbound-sdk/insights";
import { memory } from "outbound-sdk/memory";
import { createTools } from "outbound-sdk/tools";

import { extra, outbound } from "./outbound.ts";
import { seed } from "./seed.ts";

const names = (tools: readonly { readonly name: string }[]): string =>
  tools.map((tool) => tool.name).join(", ");

// An instance with no plugins: the tools that need one are left out.
const plain = createOutbound({ adapter: memory({ data: seed }) });

console.log("no plugins:", names(createTools(plain)));

// The identity plugin is on `outbound`, so one more tool is offered.
const tools = createTools(outbound, { extra });

console.log("\nwith identity and three insights:", names(tools));

// `only` narrows the built-in tools to the ones you name.
console.log(
  "\nonly:",
  names(createTools(outbound, { only: ["campaign_overview", "reply_samples"] }))
);

console.log("\nevery insight as a tool:", insightTools(outbound).length);

// A tool is a name, a description written for a model, its input as JSON
// Schema, and `call`.
const [overview] = tools;

console.log(`\n${overview?.name}: ${overview?.description}`);

console.log(JSON.stringify(overview?.parameters, null, 2));
