// Tells the model which client a conversation belongs to. The tools are
// already scoped (see tools/outbound.ts); this keeps the model's words in
// line with what it can see.

import { defineDynamic, defineInstructions } from "eve/instructions";

import { CLIENTS } from "../lib/clients";
import { clientInScope } from "../lib/scope";

export default defineDynamic((ctx) => {
  const client = clientInScope(ctx.channel);

  return defineInstructions({
    content:
      client === undefined
        ? `This is an internal agency conversation. You can see every client: ${CLIENTS.map((entry) => `${entry.name} (workspace "${entry.id}")`).join(", ")}. Name the client with every number.`
        : `This is ${client.name}'s shared channel, and ${client.name} may be reading. Your tools see only ${client.name}'s data. Do not mention the agency's other clients.`,
  });
});
