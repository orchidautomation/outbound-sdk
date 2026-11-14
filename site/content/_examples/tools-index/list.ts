import { createOutbound } from "outbound-sdk";
import { clients } from "outbound-sdk/clients";
import { identity } from "outbound-sdk/identity";
import { demoData, memory } from "outbound-sdk/memory";
import { createTools, TOOL_NAMES } from "outbound-sdk/tools";

const adapter = () => memory({ data: demoData(), workspaceId: "acme" });

const names = (tools: readonly { name: string }[]) =>
  tools.map((tool) => tool.name).join(", ");

// No plugins: the two tools that need one are left out.
const plain = createOutbound({ adapter: adapter() });

console.log(`${createTools(plain).length} of ${TOOL_NAMES.length}:`);

console.log(names(createTools(plain)));

// With the clients and identity plugins, their tools are offered too.
const full = createOutbound({
  adapter: adapter(),
  plugins: [clients(), identity()],
});

const offered = createTools(full);

console.log(`\n${offered.length} of ${TOOL_NAMES.length}:`);

console.log(names(offered));

console.log(
  "left out:",
  TOOL_NAMES.filter((name) => !offered.some((tool) => tool.name === name))
);

// `only` narrows the set to the tools you name.
console.log(
  "\nonly:",
  names(createTools(full, { only: ["campaign_overview", "reply_samples"] }))
);

// Each tool carries its input as JSON Schema.
const [overview] = offered;

console.log(
  `\n${overview?.name}:`,
  JSON.stringify(overview?.parameters, null, 2)
);
