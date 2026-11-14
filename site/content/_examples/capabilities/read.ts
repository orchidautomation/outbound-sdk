import { CAPABILITY_KEYS, createOutbound } from "outbound-sdk";
import { heyreach } from "outbound-sdk/heyreach";
import { instantly } from "outbound-sdk/instantly";
import { smartlead } from "outbound-sdk/smartlead";

// Constructing an instance sends nothing, so neither does this.
const vendors = [
  createOutbound({ adapter: instantly() }),
  createOutbound({ adapter: smartlead() }),
  createOutbound({ adapter: heyreach() }),
];

console.log(CAPABILITY_KEYS.length, "keys");

const keys = [
  "campaigns.settings",
  "leads.list",
  "leads.since",
  "messages.body",
  "stats.byStep",
  "stats.bySender",
  "events.verify",
] as const;

for (const key of keys) {
  console.log(
    key.padEnd(20),
    vendors
      .map((outbound) => `${outbound.provider} ${outbound.capabilities[key]}`)
      .join(" | ")
  );
}
