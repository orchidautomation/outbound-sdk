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

console.log({
  company: lead.company,
  custom: lead.custom,
  email: lead.email,
  firstName: lead.firstName,
  lastName: lead.lastName,
  linkedinUrl: lead.linkedinUrl,
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
