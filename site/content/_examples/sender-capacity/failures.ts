import { createOutbound, OutboundError } from "outbound-sdk";
import { insights } from "outbound-sdk/insights";
import { memory } from "outbound-sdk/memory";

import { seed } from "./seed.ts";

// 1. No sender reports a daily limit. Capacity is unknown, not 0.
const noLimits = createOutbound({
  adapter: memory({
    data: { senders: [{ address: "ana@example.com", id: "snd_ana" }] },
  }),
  plugins: [insights()],
});

const unknown = await noLimits.insights.senderCapacity({});

console.log(
  "no limits:",
  unknown.data.capacity.daily,
  "-",
  unknown.data.finding
);

// 2. An adapter that cannot read campaign settings. Capacity is still
//    reported; what the campaigns ask for is null, and a note says why.
const noSettings = createOutbound({
  adapter: memory({
    capabilities: { "campaigns.settings": false },
    data: seed,
  }),
  plugins: [insights()],
});

const partial = await noSettings.insights.senderCapacity({});

console.log("no settings:", partial.data.ask, partial.meta.notes);

const outbound = createOutbound({
  adapter: memory({ data: seed, workspaceId: "acme" }),
  plugins: [insights()],
});

// 3. More campaigns than the cap. The ask covers the campaigns read.
const capped = await outbound.insights.senderCapacity({ max_campaigns: 1 });

console.log(
  "capped:",
  capped.meta.complete,
  capped.data.ask?.daily,
  capped.meta.notes
);

// 4. Input outside its range is refused before any request.
try {
  await outbound.insights.senderCapacity({ days: 0 });
} catch (error) {
  if (OutboundError.is(error)) {
    console.log("bad input:", error.code, "-", error.message);
  }
}

// 5. An adapter that cannot list senders refuses all three insights.
const noSenders = createOutbound({
  adapter: memory({ capabilities: { "senders.list": false }, data: seed }),
  plugins: [insights()],
});

try {
  await noSenders.insights.senderCapacity({});
} catch (error) {
  if (OutboundError.is(error)) {
    console.log("no senders:", error.code, "-", error.message);
  }
}
