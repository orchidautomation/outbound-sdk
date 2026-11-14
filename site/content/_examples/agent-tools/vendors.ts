import { createOutbound } from "outbound-sdk";
import { identity } from "outbound-sdk/identity";
import { insightTools } from "outbound-sdk/insights";
import { createTools } from "outbound-sdk/tools";

import { asVendor, VENDORS } from "../_shared/as-vendor.ts";
import { seed } from "./seed.ts";

const QUESTIONS = [
  ["campaign_overview", {}],
  ["winning_steps", { campaign: "cmp_founders" }],
  ["campaign_setup", { campaign: "cmp_founders" }],
  ["reply_samples", { category: "positive" }],
  ["cross_channel_lead", { person: "dana@example.com" }],
] as const;

for (const vendor of VENDORS) {
  const outbound = createOutbound({
    adapter: asVendor(vendor, seed, "acme"),
    plugins: [identity()],
  });

  const tools = createTools(outbound, { extra: insightTools(outbound) });
  console.log(`${vendor}: ${tools.length} tools`);

  for (const [name, input] of QUESTIONS) {
    const tool = tools.find((candidate) => candidate.name === name);
    // oxlint-disable-next-line no-await-in-loop -- one call at a time keeps the output in order.
    const result = await tool?.call(input);

    if (result === undefined) {
      console.log(`  ${name}: not offered`);
    } else if (!result.ok) {
      console.log(`  ${name}: ${result.error.code}: ${result.error.message}`);
    }
  }
}
