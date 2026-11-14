// Reads the way an agent should: a count the vendor does not report stays
// null, a card shows it as a dash, and `meta`, `next` and the insight's notes
// travel with the numbers.
import { createOutbound } from "outbound-sdk";
import type { Json, JsonObject } from "outbound-sdk";
import { cardFor, toSlackMessage } from "outbound-sdk/cards";
import { insightTools } from "outbound-sdk/insights";
import { memory } from "outbound-sdk/memory";
import { createTools } from "outbound-sdk/tools";

import { seed } from "./seed.ts";

const outbound = createOutbound({
  adapter: memory({ data: seed, workspaceId: "acme" }),
});

const isObject = (value: Json | undefined): value is JsonObject =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const tools = createTools(outbound, { extra: insightTools(outbound) });

const tool = (name: string) => {
  const found = tools.find((candidate) => candidate.name === name);

  if (found === undefined) {
    throw new Error(`${name} is not offered`);
  }

  return found;
};

const overview = await tool("campaign_overview").call({ status: "active" });

console.log(JSON.stringify(overview, null, 2));

// The same answer as a card. A count that is not reported is a dash, not 0.
const message = toSlackMessage(cardFor("campaign_overview", overview));

console.log(message.text);

// The table's rows, as a person reading the card in Slack sees them.
for (const block of message.blocks) {
  const rows =
    isObject(block) && block["type"] === "data_table" ? block["rows"] : null;

  for (const row of Array.isArray(rows) ? rows : []) {
    const cells = Array.isArray(row) ? row : [];

    console.log(
      cells.map((cell) => (isObject(cell) ? cell["text"] : "")).join(" | ")
    );
  }
}

// An insight wraps its answer: `result`, then `complete` and `notes`.
const ranking = await tool("campaign_ranking").call({ max_campaigns: 1 });

if (ranking.ok && isObject(ranking.data)) {
  console.log("complete:", ranking.data["complete"], ranking.data["notes"]);
}
