import { createOutbound } from "outbound-sdk";
import { fromEnv, loadableProviders } from "outbound-sdk/loader";
import { providers } from "outbound-sdk/providers";

// The catalog imports no adapter, so it is safe in a config screen.
for (const provider of providers) {
  const required = provider.envVars
    .filter((variable) => variable.required)
    .map((variable) => variable.name);

  console.log(provider.id, provider.maturity, provider.channels, required);
}

// fromEnv() builds the adapter OUTBOUND_SDK_PROVIDER names, or the one you
// pass. Only that adapter's code is loaded.
console.log(loadableProviders());

const outbound = createOutbound({
  adapter: await fromEnv({ provider: "memory" }),
});

const campaigns = await outbound.campaigns.list();

console.log(outbound.provider, campaigns.items.length);
