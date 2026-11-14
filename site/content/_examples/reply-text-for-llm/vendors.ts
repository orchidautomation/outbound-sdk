import { createOutbound } from "outbound-sdk";
import { redact } from "outbound-sdk/redact";
import { createTools } from "outbound-sdk/tools";

import { asVendor, VENDORS } from "../_shared/as-vendor.ts";
import { seed } from "./seed.ts";

for (const vendor of VENDORS) {
  const outbound = createOutbound({ adapter: asVendor(vendor, seed, "acme") });
  const { capabilities } = outbound;

  console.log(
    `${vendor}: messages.body ${capabilities["messages.body"]}, replies.category ${capabilities["replies.category"]}`
  );

  const [replySamples] = createTools(outbound, { only: ["reply_samples"] });

  // oxlint-disable-next-line no-await-in-loop -- one vendor at a time keeps the output in order.
  const byCategory = await replySamples?.call({
    category: "positive",
    include_bodies: true,
  });

  console.log(
    "  positive replies with text:",
    byCategory?.ok
      ? "ok"
      : `${byCategory?.error.code}: ${byCategory?.error.message}`
  );

  const masked = createOutbound({
    adapter: asVendor(vendor, seed, "acme"),
    plugins: [redact()],
  });

  // oxlint-disable-next-line no-await-in-loop -- as above.
  const refused = await createTools(masked, {
    only: ["reply_samples"],
  })[0]?.call({
    include_bodies: true,
  });

  console.log("  with redact():", refused?.ok ? "ok" : refused?.error.code);
}
