import { createOutbound, OutboundError } from "outbound-sdk";
import type { OutboundPlugin } from "outbound-sdk";
import { memory } from "outbound-sdk/memory";
import { redact } from "outbound-sdk/redact";

import { seed } from "../plugins-index/seed.ts";

const describe = (error: OutboundError): string =>
  `${error.code} - ${error.message}`;

const outbound = createOutbound({
  adapter: memory({ data: seed, workspaceId: "agency" }),
  plugins: [redact()],
});

// 1. Asking for bodies while bodies are masked is refused before any read.
try {
  await outbound.messages.list({ include: ["body"] });
} catch (error) {
  if (OutboundError.is(error)) {
    console.log("bodies:", describe(error));
  }
}

// 2. A plugin listed twice is refused when the instance is built.
try {
  createOutbound({
    adapter: memory({ data: seed }),
    plugins: [redact(), redact({ fields: ["email"] })],
  });
} catch (error) {
  if (OutboundError.is(error)) {
    console.log("twice:", describe(error));
  }
}

// 3. A record redact does not recognise is refused, not passed through.
//    This inner plugin returns something that is not an SDK record.
const stranger: OutboundPlugin = {
  name: "stranger",
  wrap: async (operation, next) => {
    const output = await next(operation);

    // SAFETY: deliberately not a record, to show what redact does with one.
    return { ...output, items: [{ ref: "x" } as never] };
  },
};

try {
  await createOutbound({
    adapter: memory({ data: seed }),
    plugins: [redact(), stranger],
  }).leads.list();
} catch (error) {
  if (OutboundError.is(error)) {
    console.log("unknown record:", describe(error));
  }
}
