import { OutboundError } from "outbound-sdk";

import { build } from "./instance.ts";

const attempt = async (
  label: string,
  read: () => Promise<object>
): Promise<void> => {
  try {
    await read();
    console.log(`${label}: answered`);
  } catch (error) {
    if (!OutboundError.is(error)) {
      throw error;
    }

    console.log(`${label}: ${error.code}, permanent ${error.permanent}`);
  }
};

// Every case starts with one good read, so a last good answer exists.

// 1. The key is rejected. Serving old data would hide a problem only you
//    can fix.
const badKey = build();

await badKey.outbound.campaigns.list();

badKey.pass(10);

badKey.vendor.fail("Unauthorized");

await attempt("rejected key", () => badKey.outbound.campaigns.list());

// 2. The record is gone. The old copy is not served in its place.
const gone = build();

await gone.outbound.campaigns.get("cmp_founders");

gone.pass(10);

gone.vendor.fail("NotFound");

await attempt("deleted record", () =>
  gone.outbound.campaigns.get("cmp_founders")
);

// 3. The last good answer is older than `maxAge` (here 5 minutes).
const old = build({ maxAge: 300 });

await old.outbound.campaigns.list();

old.pass(10);

old.vendor.fail("Provider");

await attempt("answer too old", () => old.outbound.campaigns.list());

// 4. The same listing with another filter is another read. It was never
//    answered, so there is nothing to serve.
const other = build();

await other.outbound.campaigns.list();

other.pass(10);

other.vendor.fail("Provider");

await attempt("different filter", () =>
  other.outbound.campaigns.list({ status: "paused" })
);

await attempt("same read as before", () => other.outbound.campaigns.list());
