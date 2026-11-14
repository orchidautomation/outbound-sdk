import { createOutbound, OutboundError } from "outbound-sdk";
import { demoData, memory } from "outbound-sdk/memory";

const outbound = createOutbound({ adapter: memory({ data: demoData() }) });

console.log(outbound.provider, outbound.workspaceId, outbound.maturity);

console.log("caveats:", outbound.caveats.length);

console.log("native:", outbound.capabilities.native);

console.log("events.parse:", outbound.capabilities["events.parse"]);

console.log("events.verify:", outbound.capabilities["events.verify"]);

console.log("estimate:", outbound.estimate({ action: "leads.list" }).basis);

const attempt = async <Result>(label: string, read: () => Promise<Result>) => {
  try {
    await read();
  } catch (error) {
    if (!OutboundError.is(error)) {
      throw error;
    }

    console.log(label, "-", error.code);
  }
};

await attempt("native", () => outbound.native.read("anything"));

await attempt("raw", () => outbound.raw.get("/campaigns"));

// The webhooks collection lists what the seed holds. It receives nothing.
const webhooks = await outbound.webhooks.list();

console.log("webhooks:", webhooks.items.length, webhooks.meta.requests);
