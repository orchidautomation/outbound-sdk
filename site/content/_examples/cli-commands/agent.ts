import { outbound, outboundSummary } from "./cli.ts";

interface Named {
  readonly name: string;
}

// SAFETY: `outbound tools` and `outbound insight` print a JSON array of objects that each have a name.
const names = (text: string) =>
  (JSON.parse(text) as Named[]).map((entry) => entry.name);

await outboundSummary(
  ["tools"],
  (text) =>
    `a JSON array of ${names(text).length} tools, each with name, description and parameters (its inputs as JSON Schema): ${names(text).join(", ")}`
);

// A tool that needs input, given none, prints what it takes.
await outbound("tool", "winning_steps");

await outbound("tool", "sender_health", "--input", '{"limit":1}');

// A tool that fails prints its result on standard output and exits 1.
await outbound(
  "tool",
  "campaign_trend",
  "--input",
  '{"campaign":"cmp_founders","from":"last month"}'
);

await outboundSummary(
  ["insight"],
  (text) =>
    `a JSON array of ${names(text).length} insights, each with name, key, description, needs and parameters: ${names(text).join(", ")}`
);

await outbound("insight", "channel_mix", "--input", '{"max_campaigns":5}');

// An insight that fails exits 1, like any other command.
await outbound("insight", "channel_mix", "--input", '{"days":30}');
