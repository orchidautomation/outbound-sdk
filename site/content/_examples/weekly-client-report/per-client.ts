import { createOutbound } from "outbound-sdk";
import { combine } from "outbound-sdk/combine";
import { insights } from "outbound-sdk/insights";
import { memory } from "outbound-sdk/memory";

import { weeklyReport } from "./report.ts";
import { seed } from "./seed.ts";

// One adapter per client key. `workspaceId` is your own label for the client.
const outbound = createOutbound({
  adapter: combine([
    memory({ data: seed, workspaceId: "acme" }),
    memory({ data: { campaigns: [] }, workspaceId: "globex" }),
  ]),
  plugins: [insights()],
});

for (const workspace of await outbound.workspaces.listAll().toArray()) {
  const client = outbound.workspace(workspace.workspaceId);
  const report = await weeklyReport(client);

  console.log(report.split("\n").slice(0, 3).join("\n"), "\n");
}
