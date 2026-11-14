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
const person = "dana@example.com";

const withLead = {
  ...acmeEmail,
  leads: [{ campaignId: "cmp_1", email: person, id: "lead_1" }],
};

const base = memory({ data: withLead, name: "emailtool", workspaceId: "b" });

const rejected = (): Promise<never> =>
  Promise.reject(
    new OutboundError("Unauthorized", "emailtool responded 401", {
      provider: "emailtool",
      status: 401,
    })
  );

const oneDown = createOutbound({
  adapter: combine([
    memory({ data: withLead, name: "emailtool", workspaceId: "a" }),
    { ...base, listLeads: rejected, stats: rejected },
  ]),
});

await attempt("one key rejected", () => oneDown.stats());

await attempt("the other client alone", () => oneDown.workspace("a").stats());

// 6. A person lookup is the exception. It returns what the members that
//    answered hold, says the answer is incomplete, and names the member
//    that did not answer.
const lookup = await oneDown.leads.list({ email: person });

console.log(
  "lookup with one key rejected:",
  lookup.items.map((lead) => lead.ref),
  "complete:",
  lookup.complete
);

console.log(lookup.failures);
