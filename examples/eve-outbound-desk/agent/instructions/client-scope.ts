// Tells the model whose conversation this is. The tools are already scoped
// (see tools/outbound.ts); this keeps the model's words in line with what it
// can see.

import { defineDynamic, defineInstructions } from "eve/instructions";

import { CLIENTS } from "../lib/clients";
import { scopeOf } from "../lib/scope";

const clientList = (): string =>
  [...new Map(CLIENTS.map((client) => [client.id, client])).values()]
    .map((client) => `${client.name} (workspace "${client.id}")`)
    .join(", ");

const NOT_CONNECTED =
  "This Slack conversation is not connected to any client, so you have no outbound tools here and must not discuss any client's campaigns, even from memory of other conversations. If someone asks, say this channel isn't set up for the outbound desk yet and that an agency admin can add it.";

export default defineDynamic((ctx) => {
  const scope = scopeOf(ctx.channel);

  if (scope.kind === "none") {
    return defineInstructions({ content: NOT_CONNECTED });
  }

  if (scope.kind === "client") {
    const { name } = scope.client;

    return defineInstructions({
      content: `This is ${name}'s shared channel, and ${name} may be reading. Your tools see only ${name}'s data. Do not mention the agency's other clients.`,
    });
  }

  return defineInstructions({
    content: `This is an internal agency conversation. You can see every client: ${clientList()}. Name the client with every number.`,
  });
});
