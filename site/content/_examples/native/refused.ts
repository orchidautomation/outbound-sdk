import { createOutbound, OutboundError } from "outbound-sdk";
import { heyreach } from "outbound-sdk/heyreach";
import { redact } from "outbound-sdk/redact";

const attempt = async <Result>(label: string, read: () => Promise<Result>) => {
  try {
    await read();
  } catch (error) {
    if (!OutboundError.is(error)) {
      throw error;
    }

    console.log(`${label}: ${error.code} - ${error.message}`);
  }
};

const outbound = createOutbound({ adapter: heyreach() });

// Each of these is refused before any request.
await attempt("unknown name", () => outbound.native.read("allLeads"));

await attempt("unknown parameter", () =>
  outbound.native.read("campaignsForLead", { page: 2 })
);

await attempt("missing parameter", () => outbound.native.read("listById"));

await attempt("wrong type", () =>
  outbound.native.read("listById", { listId: "12" })
);

// A native payload is not redacted, so the redact plugin turns native off.
const redacted = createOutbound({ adapter: heyreach(), plugins: [redact()] });

console.log("with redact:", redacted.capabilities.native);

await attempt("with redact", () => redacted.native.reads.checkApiKey());
