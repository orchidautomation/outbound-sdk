import { setupInstructions, webhookProviders } from "outbound-sdk/webhooks";

for (const provider of webhookProviders()) {
  console.log(`${setupInstructions(provider)}\n`);
}
