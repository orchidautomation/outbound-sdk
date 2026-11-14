import { createOutbound } from "outbound-sdk";
import { clients } from "outbound-sdk/clients";
import { combine } from "outbound-sdk/combine";
import { memory } from "outbound-sdk/memory";

import { acmeEmail, acmeLinkedin, globexEmail } from "./seed.ts";

// One adapter per client key. `workspaceId` is your own label for the client.
// `name` stands in for the vendor here; a real adapter sets it for you.
export const outbound = createOutbound({
  adapter: combine([
    memory({ data: acmeEmail, name: "emailtool", workspaceId: "acme" }),
    memory({ data: acmeLinkedin, name: "linkedintool", workspaceId: "acme" }),
    memory({ data: globexEmail, name: "emailtool", workspaceId: "globex" }),
  ]),
  // With no rules, one workspace is one client.
  plugins: [clients()],
});
