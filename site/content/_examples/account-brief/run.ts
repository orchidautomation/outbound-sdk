import { createOutbound } from "outbound-sdk";
import { combine } from "outbound-sdk/combine";
import { insights } from "outbound-sdk/insights";
import { memory } from "outbound-sdk/memory";

import { accountBrief } from "./brief.ts";
import { DOMAIN, emailTool, linkedinTool } from "./seed.ts";

// Two tools behind one instance. `name` stands in for the vendor.
const outbound = createOutbound({
  adapter: combine([
    memory({ data: emailTool, name: "mailtool", workspaceId: "agency" }),
    // A LinkedIn tool cannot search leads by email domain, as HeyReach cannot,
    // so the combined instance reads every lead and matches them itself.
    memory({
      capabilities: { "leads.byDomain": false },
      data: linkedinTool,
      name: "lntool",
      workspaceId: "agency",
    }),
  ]),
  plugins: [insights()],
});

// An email address works too: its domain is used.
console.log(await accountBrief(outbound, DOMAIN));
