import { createOutbound } from "outbound-sdk";
import { memory } from "outbound-sdk/memory";
import { redact } from "outbound-sdk/redact";
import { createTools } from "outbound-sdk/tools";

import { seed } from "./seed.ts";

const outbound = createOutbound({
  adapter: memory({ data: seed }),
  plugins: [redact()],
});

const replies = createTools(outbound).find(
  (tool) => tool.name === "reply_samples"
);

// Without bodies the tool still answers.
const without = await replies?.call({});

console.log(without?.ok, without?.ok ? without.meta : without?.error);

// Asking for bodies is refused. The text never reaches the model.
console.log(
  JSON.stringify(await replies?.call({ include_bodies: true }), null, 2)
);
