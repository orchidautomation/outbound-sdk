import { createOutbound } from "outbound-sdk";
import { cardFor, toSlackMessage } from "outbound-sdk/cards";
import { demoData, memory } from "outbound-sdk/memory";
import { createTools } from "outbound-sdk/tools";

const outbound = createOutbound({
  adapter: memory({ data: demoData(), workspaceId: "acme" }),
});

const tools = new Map(createTools(outbound).map((tool) => [tool.name, tool]));
const result = await tools.get("sender_health")?.call({});

if (result === undefined) {
  throw new Error("sender_health is not offered by this adapter");
}

// The card is plain JSON: a json-render spec for the chat catalog.
const card = cardFor("sender_health", result);

// `{ text, blocks }`: spread it into `chat.postMessage`, or POST it to an
// incoming webhook as the request body.
const message = toSlackMessage(card);

console.log(message.text);

console.log(JSON.stringify(message.blocks, null, 2));
