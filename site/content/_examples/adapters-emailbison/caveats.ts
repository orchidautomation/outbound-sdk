import { createOutbound } from "outbound-sdk";
import { emailbison } from "outbound-sdk/emailbison";

const outbound = createOutbound({
  adapter: emailbison({ apiKey: "your-api-key" }),
});

// What the adapter assumes and has not confirmed. No request is made.
for (const caveat of outbound.caveats) {
  console.log(`- ${caveat}\n`);
}
