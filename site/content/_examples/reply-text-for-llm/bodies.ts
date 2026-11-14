import { createOutbound } from "outbound-sdk";
import { memory } from "outbound-sdk/memory";
import { createTools } from "outbound-sdk/tools";

import { seed } from "./seed.ts";

const outbound = createOutbound({
  adapter: memory({ data: seed, workspaceId: "acme" }),
});

const [replySamples] = createTools(outbound, { only: ["reply_samples"] });

// 1. By default a reply comes back with its category and no text.
const without = await replySamples?.call({ limit: 1 });

console.log(JSON.stringify(without?.ok ? without.data : without, null, 2));

// 2. With include_bodies the text is there, cut to 500 characters and
//    wrapped with a note. It is the prospect's text, unchanged.
const withText = await replySamples?.call({ include_bodies: true });

console.log(JSON.stringify(withText?.ok ? withText.data : withText, null, 2));
