import { CAPABILITY_KEYS, createOutbound } from "outbound-sdk";
import { combine } from "outbound-sdk/combine";

import { asVendor } from "../_shared/as-vendor.ts";
import { acmeEmail, acmeLinkedin } from "./seed.ts";

const email = createOutbound({
  adapter: asVendor("instantly", acmeEmail, "acme"),
});

const linkedin = createOutbound({
  adapter: asVendor("heyreach", acmeLinkedin, "acme"),
});

const both = createOutbound({
  adapter: combine([
    asVendor("instantly", acmeEmail, "acme"),
    asVendor("heyreach", acmeLinkedin, "acme"),
  ]),
});

// A combined instance promises only what every member can do.
for (const key of CAPABILITY_KEYS) {
  if (both.capabilities[key] === false) {
    const had = [email, linkedin].flatMap((member) =>
      member.capabilities[key] === false ? [] : [member.provider]
    );

    if (had.length > 0) {
      console.log(`${key}: off when combined, on for ${had.join(" and ")}`);
    }
  }
}
