import { createOutbound } from "outbound-sdk";
import { reconcile } from "outbound-sdk/reconcile";
import { parse } from "outbound-sdk/webhooks";

import { asVendor } from "../_shared/as-vendor.ts";
import type { Vendor } from "../_shared/as-vendor.ts";
import { payload, post } from "./payloads.ts";

// One documented payload per vendor, each announcing a message.
const DOCUMENTED: readonly { name: string; vendor: Vendor }[] = [
  { name: "email_sent", vendor: "instantly" },
  { name: "EMAIL_SENT", vendor: "smartlead" },
  { name: "voice_note_received", vendor: "heyreach" },
];

const receiveAs = async (vendor: Vendor, name: string): Promise<string> => {
  // No provider is named, so the parser is picked from the payload's shape.
  const events = await parse(post(payload(vendor, name)), {
    workspaceId: "acme",
  });

  const outbound = createOutbound({
    adapter: asVendor(vendor, {}, "acme"),
    plugins: [reconcile()],
  });

  const report = await outbound.reconcile.events({
    events,
    since: "2026-11-01T00:00:00.000Z",
  });

  return events
    .map((event) => {
      const names = event.messageRef === null ? "no message" : "a message";

      return `${event.provider}: ${name} is ${event.type}, names ${names}; reconcile compared ${report.checked}, could not compare ${report.uncheckable}`;
    })
    .join("\n");
};

const lines = await Promise.all(
  DOCUMENTED.map(({ name, vendor }) => receiveAs(vendor, name))
);

console.log(lines.join("\n"));
