import { createOutbound, OutboundError } from "outbound-sdk";
import { demoData, memory } from "outbound-sdk/memory";

const outbound = createOutbound({ adapter: memory({ data: demoData() }) });

const show = async <Result>(call: () => Promise<Result>): Promise<void> => {
  try {
    await call();
  } catch (error) {
    if (OutboundError.is(error)) {
      console.log(error.code, "-", error.message);
    }
  }
};

await show(() => outbound.stats({ from: "11/01/2026" }));

await show(() => outbound.stats({ from: "2026-11-10", to: "2026-11-01" }));

await show(() => outbound.stats({ scope: "campaign" }));

await show(() => outbound.replies.list({ since: "yesterday" }));

await show(() => outbound.leads.list({ limit: 2.5 }));

await show(() => outbound.campaigns.get(" "));

await show(() =>
  outbound.leads.list({ campaignId: "cmp_founders", listId: "lst_founders" })
);

// A ref from another workspace.
await show(() => outbound.campaigns.get("memory:other-client:cmp_founders"));

// A cursor from another listing.
const page = await outbound.leads.list({ limit: 1 });

await show(() => outbound.replies.list({ cursor: page.cursor }));
