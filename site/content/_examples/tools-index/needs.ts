import { createOutbound } from "outbound-sdk";
import { clients } from "outbound-sdk/clients";
import { identity } from "outbound-sdk/identity";
import { demoData, memory } from "outbound-sdk/memory";
import { createTools } from "outbound-sdk/tools";

const full = createOutbound({
  adapter: memory({ data: demoData() }),
  plugins: [clients(), identity()],
});

// Each tool says what it cannot work without.
for (const tool of createTools(full)) {
  console.log(`${tool.name.padEnd(21)} ${tool.needs.join(", ")}`);
}

// Turn one capability off and the tools that need it are gone from the set.
const noDailyStats = createOutbound({
  adapter: memory({ capabilities: { "stats.byDay": false }, data: demoData() }),
  plugins: [clients(), identity()],
});

const offered = new Set(createTools(noDailyStats).map((tool) => tool.name));

console.log(
  "\nwithout stats.byDay, left out:",
  createTools(full)
    .map((tool) => tool.name)
    .filter((name) => !offered.has(name))
    .join(", ")
);
