import { createOutbound } from "outbound-sdk";
import { memory } from "outbound-sdk/memory";

// Filters a vendor applies that the memory adapter leaves off by default can
// be turned on, and then they filter, as the vendor's would.
const outbound = createOutbound({
  adapter: memory({
    capabilities: { "leads.byInterest": true, "messages.byHand": true },
    data: {
      leads: [
        { email: "ana@example.com", id: "l1", interestCategory: "positive" },
        { email: "ben@example.com", id: "l2", interestCategory: "negative" },
      ],
      messages: [
        { direction: "out", id: "m1", sentAt: "2026-11-01T09:00:00.000Z" },
        {
          byHand: true,
          direction: "out",
          id: "m2",
          sentAt: "2026-11-02T09:00:00.000Z",
        },
      ],
    },
  }),
});

const positive = await outbound.leads.list({ interest: "positive" });
const byHand = await outbound.messages.list({ byHand: true });

console.log(
  "positive leads:",
  positive.items.map((lead) => lead.email)
);

console.log(
  "sent by hand:",
  byHand.items.map((message) => message.ref)
);
