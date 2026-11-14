import { createOutbound } from "outbound-sdk";
import { combine } from "outbound-sdk/combine";
import { heyreach } from "outbound-sdk/heyreach";
import { instantly } from "outbound-sdk/instantly";
import { smartlead } from "outbound-sdk/smartlead";

// One adapter per key. Each `workspaceId` is your own label for the client.
// The keys are read from your own environment variables or secret store.
const outbound = createOutbound({
  adapter: combine([
    instantly({ apiKey: process.env.ACME_INSTANTLY_KEY, workspaceId: "acme" }),
    heyreach({ apiKey: process.env.ACME_HEYREACH_KEY, workspaceId: "acme" }),
    smartlead({
      apiKey: process.env.GLOBEX_SMARTLEAD_KEY,
      workspaceId: "globex",
    }),
  ]),
});

// Nothing below makes a request.
console.log("maturity:", outbound.maturity);

console.log("caveats:", outbound.caveats.length);

console.log(outbound.caveats[0]?.slice(0, 60));

// One rate budget per member, each from its own vendor's declared limits.
for (const snapshot of await outbound.limits()) {
  const [first] = snapshot.windows;

  console.log(
    snapshot.provider,
    snapshot.workspaceId,
    `${first?.requests} per ${(first?.perMs ?? 0) / 1000}s`
  );
}
