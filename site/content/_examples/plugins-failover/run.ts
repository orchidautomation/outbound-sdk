import { createOutbound, OutboundError } from "outbound-sdk";
import { memoryCacheStore } from "outbound-sdk/cache";
import { failover } from "outbound-sdk/failover";
import { memory } from "outbound-sdk/memory";

import { seed } from "../plugins-index/seed.ts";
import { outage, vendor } from "./outage.ts";

// One clock for the SDK and the plugin, so the sample can move time forward.
let now = Date.parse("2026-11-14T12:00:00.000Z");
const clock = (): number => now;
const HOUR = 3_600_000;

const outbound = createOutbound({
  adapter: memory({ data: seed, workspaceId: "agency" }),
  plugins: [
    // Serve an answer for up to a day.
    failover({ maxAge: 86_400, now: clock, store: memoryCacheStore() }),
    outage,
  ],
  runtime: { now: clock },
});

const show = async (label: string): Promise<void> => {
  try {
    const page = await outbound.campaigns.list();

    console.log(
      `${label}: ${page.items.length} campaigns, stale ${page.meta.stale}, fetched ${page.meta.fetchedAt}`
    );
  } catch (error) {
    if (!OutboundError.is(error)) {
      throw error;
    }

    console.log(`${label}: ${error.code} - ${error.message}`);
  }
};

await show("vendor up          ");

vendor.down = true;

now += HOUR;

await show("down, 1 hour later ");

// A read failover never saw has nothing to serve.
try {
  await outbound.senders.list();
} catch (error) {
  if (OutboundError.is(error)) {
    console.log(`a read never seen   : ${error.code} - ${error.message}`);
  }
}

now += 24 * HOUR;

await show("down, 25 hours later");

// The caller's own mistake is never covered, vendor up or down.
vendor.down = false;

try {
  await outbound.campaigns.get("cmp_missing");
} catch (error) {
  if (OutboundError.is(error)) {
    console.log(`a missing record    : ${error.code}`);
  }
}
