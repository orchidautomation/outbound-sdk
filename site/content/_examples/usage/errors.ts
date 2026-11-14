import { createOutbound, OutboundError } from "outbound-sdk";
import { demoData, memory } from "outbound-sdk/memory";

const outbound = createOutbound({
  // An adapter that, like HeyReach, cannot read campaign settings.
  adapter: memory({
    capabilities: { "campaigns.settings": false },
    data: demoData(),
  }),
});

try {
  await outbound.campaigns.get("no-such-campaign");
} catch (error) {
  if (OutboundError.is(error)) {
    console.log(error.code, error.permanent);
  }
}

try {
  await outbound.campaign("cmp_founders").settings();
} catch (error) {
  if (OutboundError.is(error)) {
    console.log(error.code, "-", error.message);
  }
}

console.log(await outbound.campaigns.exists("no-such-campaign"));
