import { CAPABILITY_KEYS, createOutbound, OutboundError } from "outbound-sdk";
import { combine } from "outbound-sdk/combine";

import { asVendor } from "../_shared/as-vendor.ts";
import { acmeEmail, acmeLinkedin, globexEmail } from "./seed.ts";

// Three members: in-memory adapters limited to what Instantly and HeyReach
// declare. In production these are instantly({ ... }) and heyreach({ ... }).
const members = [
  asVendor("instantly", acmeEmail, "acme"),
  asVendor("heyreach", acmeLinkedin, "acme"),
  asVendor("instantly", globexEmail, "globex"),
];

const outbound = createOutbound({ adapter: combine(members) });

console.log(outbound.provider, outbound.workspaceId);

// What one member can do and the combined instance cannot promise.
const [instantlyOnly] = members.map((member) =>
  createOutbound({ adapter: member })
);

console.log(
  "given up:",
  CAPABILITY_KEYS.filter(
    (key) =>
      instantlyOnly?.capabilities[key] !== false &&
      outbound.capabilities[key] === false
  ).join(", ")
);

// One listing walks every member in turn. Each record keeps its own ref.
for await (const campaign of outbound.campaigns.listAll()) {
  console.log(campaign.ref, "-", campaign.name);
}

// A lookup needs the ref: three members each have a campaign "cmp_1".
const found = await outbound.campaigns.get("heyreach:acme:cmp_1");

console.log("by ref:", found.name);

try {
  await outbound.campaigns.get("cmp_1");
} catch (error) {
  if (!OutboundError.is(error)) {
    throw error;
  }

  console.log("bare id:", error.code, "-", error.message);
}

// Workspace stats: one row per member, never added together.
const stats = await outbound.stats();

for (const row of stats.rows) {
  console.log(
    row.scopeRef,
    "sent",
    row.sent,
    "connections",
    row.connectionsSent
  );
}
