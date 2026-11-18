import { createOutbound } from "outbound-sdk";
import { cardFor, toText } from "outbound-sdk/cards";
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

const card = cardFor("sender_health", result);

// Plain text, for a terminal or an email.
console.log(toText(card));

console.log("");

// Slack's mrkdwn, to paste into the message composer.
console.log(toText(card, { style: "slack" }));
