import { createOutbound } from "outbound-sdk";
import type { OutboundPlugin } from "outbound-sdk";
import { memory } from "outbound-sdk/memory";

import { seed } from "./seed.ts";

// A plugin that does nothing but say when an operation passes through it.
const layer = (name: string): OutboundPlugin => ({
  name,
  wrap: async (operation, next) => {
    console.log(`${name}: in  (${operation.kind})`);
    const output = await next(operation);
    console.log(`${name}: out (${output.items.length} records)`);

    return output;
  },
});

const outbound = createOutbound({
  adapter: memory({ data: seed, workspaceId: "agency" }),
  plugins: [layer("first"), layer("second"), layer("third")],
});

await outbound.campaigns.list();

console.log(outbound.plugins.map((plugin) => plugin.name));
