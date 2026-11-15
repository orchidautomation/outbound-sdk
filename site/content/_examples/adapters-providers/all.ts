import process from "node:process";

import { createOutbound } from "outbound-sdk";
import { configuredProviders, fromEnv } from "outbound-sdk/loader";

// Two vendor keys set, and no OUTBOUND_SDK_PROVIDER. Building an adapter
// sends no request, so these made-up keys are never checked.
const VARIABLES = [
  "OUTBOUND_SDK_PROVIDER",
  "INSTANTLY_API_KEY",
  "SMARTLEAD_API_KEY",
  "HEYREACH_API_KEY",
];

for (const name of VARIABLES) {
  Reflect.deleteProperty(process.env, name);
}

process.env["INSTANTLY_API_KEY"] = "made-up-instantly-key";

process.env["HEYREACH_API_KEY"] = "made-up-heyreach-key";

// The ids fromEnv() would build, in catalog order.
console.log(configuredProviders());

// With no provider named, fromEnv() builds every one of them, combined.
const outbound = createOutbound({ adapter: await fromEnv() });

console.log(outbound.provider);

console.log(outbound.maturity);

// A combined instance promises only what every member can do. HeyReach
// cannot read campaign settings, so the pair cannot either.
console.log(outbound.capabilities["campaigns.settings"]);

// Naming one vendor still picks that vendor alone.
const one = createOutbound({
  adapter: await fromEnv({ provider: "instantly" }),
});

console.log(one.provider, one.capabilities["campaigns.settings"]);

// With no key set, there is nothing to build.
for (const name of VARIABLES) {
  Reflect.deleteProperty(process.env, name);
}

try {
  await fromEnv();
} catch (error) {
  console.log(String(error));
}
