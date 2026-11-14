import { createOutbound } from "outbound-sdk";
import { memory } from "outbound-sdk/memory";
import {
  createTools,
  DEFAULT_BODY_CHARS,
  UNTRUSTED_NOTE,
} from "outbound-sdk/tools";

import { INJECTED, seed } from "./seed.ts";

const outbound = createOutbound({ adapter: memory({ data: seed }) });

const tools = new Map(createTools(outbound).map((tool) => [tool.name, tool]));
const replies = tools.get("reply_samples");

console.log("The reply is", INJECTED.length, "characters long.");

console.log("DEFAULT_BODY_CHARS:", DEFAULT_BODY_CHARS);

console.log("UNTRUSTED_NOTE:", UNTRUSTED_NOTE);

// Not asked for: the text is not in the result at all.
const without = await replies?.call({});

console.log("\nreply_samples {}");

console.log(JSON.stringify(without?.ok ? without.data : without, null, 2));

// Asked for: truncated, and wrapped with the note.
const withBodies = await replies?.call({ include_bodies: true });

console.log("\nreply_samples { include_bodies: true }");

console.log(
  JSON.stringify(withBodies?.ok ? withBodies.data : withBodies, null, 2)
);
