import { createOutbound } from "outbound-sdk";
import type { Json } from "outbound-sdk";
import { clients } from "outbound-sdk/clients";
import { heyreach } from "outbound-sdk/heyreach";
import { identity } from "outbound-sdk/identity";
import { instantly } from "outbound-sdk/instantly";
import { demoData } from "outbound-sdk/memory";
import { smartlead } from "outbound-sdk/smartlead";
import { createTools, TOOL_NAMES } from "outbound-sdk/tools";

import { asVendor, VENDORS } from "../_shared/as-vendor.ts";

// Constructing a real adapter makes no request. Its tool set includes
// vendor_read, because each vendor has reads of its own.
const REAL = {
  heyreach: () => createTools(createOutbound({ adapter: heyreach() })),
  instantly: () => createTools(createOutbound({ adapter: instantly() })),
  smartlead: () => createTools(createOutbound({ adapter: smartlead() })),
};

for (const vendor of VENDORS) {
  const tools = REAL[vendor]();
  console.log(
    `${vendor}: ${tools.length} tools, the last is ${tools.at(-1)?.name}`
  );
}

// Valid input for every tool, to see what each vendor's adapter is offered
// and whether a call with plain input is answered.
const INPUT = new Map<string, Json>([
  ["campaign_setup", { campaign: "cmp_founders" }],
  [
    "campaign_trend",
    { campaign: "cmp_founders", from: "2026-10-01", to: "2026-10-31" },
  ],
  ["cross_channel_lead", { person: "person1@example.com" }],
  ["lead_runway", { campaign: "cmp_founders" }],
  ["winning_steps", { campaign: "cmp_founders" }],
]);

const line = (name: string, cells: readonly string[]) =>
  [name.padEnd(21), ...cells.map((cell) => cell.padEnd(12))]
    .join(" ")
    .trimEnd();

console.log(`\n${line("tool", VENDORS)}`);

const sets = VENDORS.map((vendor) =>
  createTools(
    createOutbound({
      adapter: asVendor(vendor, demoData()),
      plugins: [clients(), identity()],
    })
  )
);

// vendor_read is left out here: the in-memory stand-in has no vendor reads.
for (const name of TOOL_NAMES.filter((tool) => tool !== "vendor_read")) {
  const cells: string[] = [];

  for (const tools of sets) {
    const tool = tools.find((candidate) => candidate.name === name);
    // oxlint-disable-next-line no-await-in-loop -- one tool at a time keeps the output in order.
    const result = await tool?.call(INPUT.get(name) ?? {});

    if (result === undefined) {
      cells.push("not offered");
    } else {
      cells.push(result.ok ? "ok" : result.error.code);
    }
  }

  console.log(line(name, cells));
}
