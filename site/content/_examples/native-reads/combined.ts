import { createOutbound, OutboundError } from "outbound-sdk";
import { combine } from "outbound-sdk/combine";
import { heyreach } from "outbound-sdk/heyreach";
import { instantly } from "outbound-sdk/instantly";

import { fixtureFetch } from "./fixture-fetch.ts";

// Two vendors behind one instance. `workspaceId` is your own label.
const outbound = createOutbound({
  adapter: combine([
    instantly({ workspaceId: "acme-email" }),
    heyreach({ workspaceId: "acme-linkedin" }),
  ]),
  fetch: fixtureFetch,
});

// The combined instance has no catalog of its own: two vendors, two sets of names.
console.log("combined:", Object.keys(outbound.native.catalog).length, "reads");

try {
  await outbound.native.read("listsForLead", { email: "alex@example.com" });
} catch (error) {
  if (OutboundError.is(error)) {
    console.log(`${error.code}: ${error.message}`);
  }
}

// Each workspace keeps its own vendor's catalog.
for (const id of ["acme-email", "acme-linkedin"]) {
  const { native } = outbound.workspace(id);

  console.log(
    `${id}: ${native.provider},`,
    Object.keys(native.catalog).length,
    "reads"
  );
}

const lists = await outbound
  .workspace("acme-linkedin")
  .native.read("listsForLead", { email: "alex@example.com" });

console.log(lists.data, lists.meta.provider, lists.meta.workspaceId);
