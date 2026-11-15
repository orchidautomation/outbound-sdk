import { createOutbound } from "outbound-sdk";
import { heyreach } from "outbound-sdk/heyreach";
import { instantly } from "outbound-sdk/instantly";
import { smartlead } from "outbound-sdk/smartlead";

// Constructing an instance sends nothing, so neither does this.
const vendors = [
  createOutbound({ adapter: instantly() }),
  createOutbound({ adapter: smartlead() }),
  createOutbound({ adapter: heyreach() }),
];

const fields = [
  ["lead", "email"],
  ["lead", "phone"],
  ["lead", "linkedinUrl"],
  ["lead", "engagement"],
  ["reply", "category"],
  ["senderHealth", "dns"],
  ["metricRow", "delivered"],
] as const;

for (const [record, field] of fields) {
  console.log(
    `${record}.${field}`.padEnd(20),
    vendors
      .map(
        (outbound) => `${outbound.provider} ${outbound.fields[record][field]}`
      )
      .join(" | ")
  );
}
