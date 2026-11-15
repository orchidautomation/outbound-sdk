import { createOutbound } from "outbound-sdk";
import { demoData, memory } from "outbound-sdk/memory";

const outbound = createOutbound({
  adapter: memory({ data: demoData(), pageSize: 2, workspaceId: "acme" }),
});

const page = await outbound.leads.list();

console.log(JSON.stringify(page, null, 2));
