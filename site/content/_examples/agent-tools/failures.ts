import { createOutbound } from "outbound-sdk";
import { memory } from "outbound-sdk/memory";
import { openaiTools } from "outbound-sdk/tools";

import { outbound } from "./outbound.ts";
import { seed } from "./seed.ts";

const { handle } = openaiTools(outbound);

// `handle` never throws. Every failure is a string to send back to the model.
const show = async (label: string, output: Promise<string>): Promise<void> => {
  console.log(`${label}: ${await output}`);
};

// 1. A tool that does not exist. There is no tool that writes.
await show("unknown tool", handle("pause_campaign", '{"campaign":"x"}'));

// 2. Arguments that are not JSON.
await show("not JSON", handle("sender_health", "{limit: 5"));

// 3. A value the input schema refuses.
await show(
  "bad value",
  handle("campaign_trend", '{"campaign":"cmp_founders","from":"last week"}')
);

// 4. An argument the tool does not take is reported, never dropped.
await show(
  "unknown argument",
  handle("campaign_overview", '{"client":"acme"}')
);

// 5. A record that does not exist.
await show("not found", handle("campaign_setup", '{"campaign":"cmp_nope"}'));

// 6. A read the adapter cannot serve. A tool that could never answer is not
//    in the list at all, so calling it is the same as calling an unknown tool.
const noSteps = openaiTools(
  createOutbound({
    adapter: memory({ capabilities: { "stats.byStep": false }, data: seed }),
  })
);

await show(
  "not offered",
  noSteps.handle("winning_steps", '{"campaign":"cmp_founders"}')
);

// 7. A tool that is offered can still be asked for something the adapter
//    cannot do. Here the vendor, like HeyReach, has no reply categories.
const noCategories = openaiTools(
  createOutbound({
    adapter: memory({
      capabilities: { "replies.category": false },
      data: seed,
    }),
  })
);

await show(
  "unsupported",
  noCategories.handle("reply_samples", '{"category":"positive"}')
);
