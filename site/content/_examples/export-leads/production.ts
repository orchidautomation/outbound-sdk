import { createOutbound } from "outbound-sdk";
import { exporter } from "outbound-sdk/exporter";
import { instantly } from "outbound-sdk/instantly";
import { redact } from "outbound-sdk/redact";

// Reads INSTANTLY_API_KEY. Swap the import for smartlead() or heyreach().
export const outbound = createOutbound({
  adapter: instantly({ workspaceId: "acme" }),
  // Drop redact() only when the file is allowed to hold personal data.
  plugins: [redact({ strategy: "hash" }), exporter()],
});
