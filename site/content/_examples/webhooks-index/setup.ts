import { setupInstructions, webhookProviders } from "outbound-sdk/webhooks";

for (const provider of webhookProviders()) {
  console.log(`${provider}\n${setupInstructions(provider)}\n`);
}
