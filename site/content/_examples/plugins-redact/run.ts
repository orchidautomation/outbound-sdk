import { createOutbound } from "outbound-sdk";
import { memory } from "outbound-sdk/memory";
import { redact } from "outbound-sdk/redact";

import { seed } from "../plugins-index/seed.ts";

const outbound = createOutbound({
  adapter: memory({ data: seed, workspaceId: "agency" }),
  plugins: [redact()],
});

const leads = await outbound.leads.list({ limit: 1 });
const [lead] = leads.items;

console.log({
  company: lead?.company,
  custom: lead?.custom,
  email: lead?.email,
  firstName: lead?.firstName,
  lastName: lead?.lastName,
  linkedinUrl: lead?.linkedinUrl,
  raw: lead?.raw,
  ref: lead?.ref,
});

const messages = await outbound.messages.list({ limit: 1 });
const [message] = messages.items;

console.log({ sentAt: message?.sentAt, subject: message?.subject });

const senders = await outbound.senders.list({ limit: 1 });
const [sender] = senders.items;

console.log({ address: sender?.address, name: sender?.name });

// Counts and campaign names are not personal data and are left alone.
const campaigns = await outbound.campaigns.list({ limit: 1 });
const [campaign] = campaigns.items;
const stats = await outbound.campaign("cmp_founders").stats();

console.log(campaign?.name, "sent", stats.rows[0]?.sent);

console.log("messages.body:", outbound.capabilities["messages.body"]);
