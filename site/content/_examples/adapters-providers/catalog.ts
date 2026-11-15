import { createOutbound } from "outbound-sdk";
import { ALL_PROVIDERS, fromEnv, loadableProviders } from "outbound-sdk/loader";
import { isProviderId, providers } from "outbound-sdk/providers";

// The catalog imports no adapter, so it is safe in a config screen.
for (const provider of providers) {
  const required = provider.envVars
    .filter((variable) => variable.required)
    .map((variable) => variable.name);

  console.log(provider.id, provider.maturity, provider.channels, required);
}

// fromEnv() builds the adapter you pass, or the one OUTBOUND_SDK_PROVIDER
// names; with neither, every vendor whose key is set (all.ts). Only the code
// of the adapters it builds is loaded.
console.log(loadableProviders());

// A name from a flag or a variable arrives as a string. isProviderId()
// checks it against the catalog and narrows it to a ProviderId.
const flag: string = "memory";

for (const name of ["heyreach", "nope", ALL_PROVIDERS]) {
  console.log(name, isProviderId(name));
}

if (!(flag === ALL_PROVIDERS || isProviderId(flag))) {
  throw new Error(`Unknown provider ${flag}`);
}

const outbound = createOutbound({
  adapter: await fromEnv({ provider: flag }),
});

const campaigns = await outbound.campaigns.list();

console.log(outbound.provider, campaigns.items.length);
