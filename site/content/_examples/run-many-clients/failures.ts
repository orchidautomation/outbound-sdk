import { createOutbound, OutboundError } from "outbound-sdk";
import { combine } from "outbound-sdk/combine";
import { memory } from "outbound-sdk/memory";

import { outbound } from "./instance.ts";
import { acmeEmail } from "./seed.ts";

const attempt = async (
  label: string,
  read: () => object | Promise<object>
): Promise<void> => {
  try {
    await read();
    console.log(`${label}: ok`);
  } catch (error) {
    if (!OutboundError.is(error)) {
      throw error;
    }

    console.log(`${label}: ${error.code} - ${error.message}`);
  }
};

// 1. Three members have a campaign "cmp_1". A bare id cannot say which.
await attempt("bare id", () => outbound.campaigns.get("cmp_1"));

await attempt("ref", () => outbound.campaigns.get("emailtool:globex:cmp_1"));

// 2. A label no adapter carries.
await attempt("unknown client", () => outbound.workspace("initech"));

// 3. Two adapters that would produce the same refs.
await attempt("same label twice", () =>
  combine([memory({ data: acmeEmail }), memory({ data: acmeEmail })])
);

// 4. A read by the vendor's own thread id names no member, so it is off on
//    every combined instance. Scope to one member to use it.
await attempt("thread on combined", () =>
  outbound.thread("thread_1").messages()
);

await attempt("thread on one workspace", () =>
  outbound.workspace("globex").thread("thread_1").messages()
);

// acme is on two tools. `provider:label` names one of them.
await attempt("thread on one member", () =>
  outbound.workspace("emailtool:acme").thread("thread_1").messages()
);

// 5. A failing member fails the combined read. Nothing is returned for the
//    members that answered.
const base = memory({ data: acmeEmail, name: "emailtool", workspaceId: "b" });

const oneDown = createOutbound({
  adapter: combine([
    memory({ data: acmeEmail, name: "emailtool", workspaceId: "a" }),
    {
      ...base,
      stats: () =>
        Promise.reject(
          new OutboundError("Unauthorized", "emailtool responded 401", {
            provider: "emailtool",
            status: 401,
          })
        ),
    },
  ]),
});

await attempt("one key rejected", () => oneDown.stats());

await attempt("the other client alone", () => oneDown.workspace("a").stats());
