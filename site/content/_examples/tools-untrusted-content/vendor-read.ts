import { createOutbound } from "outbound-sdk";
import { instantly } from "outbound-sdk/instantly";
import { redact } from "outbound-sdk/redact";
import { createTools } from "outbound-sdk/tools";

// Answers the one request this sample makes with a lead label built from
// Instantly's documented schema. It is not a live response.
const documented: typeof fetch = () =>
  Promise.resolve(
    Response.json({
      description: "Used for marking high-priority leads",
      id: "01a1d77f-5e68-7d04-857c-0b0d146db090",
      interest_status: 7,
      interest_status_label: "positive",
      label: "Hot Lead",
      use_with_ai: false,
    })
  );

const outbound = createOutbound({
  adapter: instantly({ apiKey: "example-key" }),
  fetch: documented,
});

const vendorRead = createTools(outbound).find(
  (tool) => tool.name === "vendor_read"
);

// No name: the catalog of reads, which costs no request.
const catalog = await vendorRead?.call({});

if (catalog?.ok) {
  console.log(catalog.meta, catalog.next);
}

// A name and params: the vendor's own response, wrapped.
const label = await vendorRead?.call({
  name: "leadLabel",
  params: { id: "01a1d77f-5e68-7d04-857c-0b0d146db090" },
});

console.log(JSON.stringify(label, null, 2));

// With redact on the instance the tool is not offered at all.
const redacted = createOutbound({
  adapter: instantly({ apiKey: "example-key" }),
  plugins: [redact()],
});

console.log(
  "offered with redact:",
  createTools(redacted).some((tool) => tool.name === "vendor_read")
);
