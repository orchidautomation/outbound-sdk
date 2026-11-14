// A config file for `outbound mcp --config`. It has no types, so it can be
// copied as outbound.config.mjs and run on any supported Node. The CLI puts
// redact() in front of these plugins unless the list has its own.
import { defineConfig } from "outbound-sdk/cli";
import { clients } from "outbound-sdk/clients";

export default defineConfig({
  plugins: [clients({ rules: [{ campaignTag: "acme", client: "Acme" }] })],
});
