import { createOutbound, OutboundError } from "outbound-sdk";
import { memory } from "outbound-sdk/memory";
import type { MemoryOptions } from "outbound-sdk/memory";

import { seed } from "./seed.ts";

// The same data behind an adapter that declares less, to exercise the code
// path a narrower vendor would take.
const narrower = (capabilities: MemoryOptions["capabilities"]) =>
  createOutbound({
    adapter: memory({ capabilities, data: seed, name: "narrowtool" }),
  });

const outbound = narrower({
  "campaigns.settings": false,
  "campaigns.status": "client",
  "stats.byStep": false,
});

const attempt = async <Result>(label: string, read: () => Promise<Result>) => {
  try {
    await read();
    console.log(label, "- ok");
  } catch (error) {
    if (!OutboundError.is(error)) {
      throw error;
    }

    console.log(label, "-", error.code, "-", error.message);
  }
};

await attempt("sequence", () => outbound.campaign("cmp_ops").sequence());

await attempt("settings", () => outbound.campaign("cmp_ops").settings());

await attempt("step stats", () =>
  outbound.campaign("cmp_ops").stats({ scope: "step" })
);

// A `client` filter is applied by the SDK after fetching, and says so.
const paused = await outbound.campaigns.list({ status: "paused" });

console.log(
  "paused:",
  paused.items.map((campaign) => campaign.ref),
  paused.meta.evidence
);
