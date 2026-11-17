import { createOutbound } from "outbound-sdk";
import { memory } from "outbound-sdk/memory";
import { redact } from "outbound-sdk/redact";
import type { RedactOptions } from "outbound-sdk/redact";

import { seed } from "../plugins-index/seed.ts";

// For this sample only. Keep a real key with your other secrets and read it
// from there, for example process.env.OUTBOUND_REDACT_KEY.
const key = "sample-only-key-0123456789abcdef0123";

// Each call builds a new instance, as a new process would.
const open = (options: RedactOptions) =>
  createOutbound({
    adapter: memory({ data: seed, workspaceId: "agency" }),
    plugins: [redact(options)],
  });

const first = await open({ key }).lead("lead_jane").get();
const again = await open({ key }).lead("lead_jane").get();
const unkeyed = await open({}).lead("lead_jane").get();

console.log(first.email, "|", first.firstName);

console.log("same key, another instance:", again.email === first.email);

console.log("no key:", unkeyed.email === first.email);
