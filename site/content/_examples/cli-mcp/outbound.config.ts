import { defineConfig } from "outbound-sdk/cli";
import { clients } from "outbound-sdk/clients";

// What `outbound mcp --config outbound.config.ts` loads. The CLI puts redact
// in front of these plugins, so it is the outermost layer.
export default defineConfig({
  plugins: [clients({ rules: [{ campaignTag: "acme", client: "Acme" }] })],
});
