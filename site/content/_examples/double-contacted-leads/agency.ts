import { createOutbound } from "outbound-sdk";
import { combine } from "outbound-sdk/combine";
import { insights } from "outbound-sdk/insights";
import { memory } from "outbound-sdk/memory";

import { emailTool, linkedinTool } from "./seed.ts";

// Two tools behind one instance. `name` stands in for the vendor: every
// record keeps it as `provider`.
export const outbound = createOutbound({
  adapter: combine([
    memory({ data: emailTool, name: "mailtool", workspaceId: "agency" }),
    memory({ data: linkedinTool, name: "lntool", workspaceId: "agency" }),
  ]),
  plugins: [insights()],
});
