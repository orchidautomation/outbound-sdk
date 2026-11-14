import { createOutbound } from "outbound-sdk";
import { combine } from "outbound-sdk/combine";
import { insights } from "outbound-sdk/insights";
import { memory } from "outbound-sdk/memory";

import { LINKEDIN, MAIL } from "./seed.ts";

// Two tools behind one instance. `name` is the provider each record carries.
export const outbound = createOutbound({
  adapter: combine([
    memory({ data: MAIL, name: "mailtool", workspaceId: "acme" }),
    memory({ data: LINKEDIN, name: "linkedintool", workspaceId: "acme" }),
  ]),
  plugins: [insights()],
});
