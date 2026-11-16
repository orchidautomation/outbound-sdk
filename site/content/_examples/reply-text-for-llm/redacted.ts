import { createOutbound } from "outbound-sdk";
import { heyreach } from "outbound-sdk/heyreach";
import { memory } from "outbound-sdk/memory";
import { redact } from "outbound-sdk/redact";
import { createTools } from "outbound-sdk/tools";

import { seed } from "./seed.ts";

// redact() with no options masks every field it knows. List it first.
const masked = createOutbound({
  adapter: memory({ data: seed, workspaceId: "acme" }),
  plugins: [redact()],
});

// What it turns off, read from a real adapter's declaration. No request is made.
const vendor = heyreach();
const before = createOutbound({ adapter: vendor }).capabilities;

const after = createOutbound({
  adapter: vendor,
  plugins: [redact()],
}).capabilities;

for (const key of ["messages.body", "native"] as const) {
  console.log(`heyreach ${key}: ${before[key]} -> ${after[key]}`);
}

const lead = await masked.leads.get("lead_dana");

// An address or a profile becomes a token keyed for this instance, so people
// can still be told apart. Its 16 hex characters change from run to run.
const token = (value: string | null): string | null =>
  value?.replace(/[0-9a-f]{16}$/u, "…") ?? null;

console.log({
  company: lead.company,
  custom: lead.custom,
  email: token(lead.email),
  firstName: lead.firstName,
  lastName: lead.lastName,
  linkedinUrl: token(lead.linkedinUrl),
  raw: lead.raw,
  ref: lead.ref,
  status: lead.status,
});

// A reply keeps its category and time. Its subject is masked and its text
// was never read.
const page = await masked.replies.list({ limit: 1 });
const [reply] = page.items;

console.log({
  bodyText: reply?.bodyText,
  category: reply?.category,
  leadRef: reply?.leadRef,
  sentAt: reply?.sentAt,
  subject: reply?.subject,
});

// A model that asks for the text is refused. Nothing is returned masked.
const [replySamples] = createTools(masked, { only: ["reply_samples"] });

console.log(await replySamples?.call({ include_bodies: true }));
