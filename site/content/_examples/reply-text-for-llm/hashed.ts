import { createOutbound } from "outbound-sdk";
import { memory } from "outbound-sdk/memory";
import { redact } from "outbound-sdk/redact";

import { repliesForPrompt } from "./prompt.ts";
import { seed } from "./seed.ts";

// Mask who the people are, keep what they wrote. Leaving "body" out of
// `fields` keeps messages.body on. "hash" swaps each value for a stable
// token, so the same person can still be counted and joined.
const outbound = createOutbound({
  adapter: memory({ data: seed, workspaceId: "acme" }),
  plugins: [
    redact({
      fields: ["company", "custom", "email", "linkedin", "name"],
      strategy: "hash",
    }),
  ],
});

console.log("messages.body:", outbound.capabilities["messages.body"]);

console.log("native:", outbound.capabilities.native);

const first = await outbound.leads.get("lead_dana");
const again = await outbound.leads.get("lead_dana");

console.log({ email: first.email, firstName: first.firstName });

console.log("same token on a second read:", first.email === again.email);

// The fields are masked. The text is not: Dana's reply still carries the
// phone number and address she typed into it.
console.log(await repliesForPrompt(outbound, 2));
