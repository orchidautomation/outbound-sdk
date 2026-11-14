import { createOutbound } from "outbound-sdk";
import { memory } from "outbound-sdk/memory";

import { seed } from "./seed.ts";

const outbound = createOutbound({
  adapter: memory({ data: seed, pageSize: 1, workspaceId: "acme" }),
});

// Defaults: a campaign with only an id is named after it, active and email.
for await (const campaign of outbound.campaigns.listAll()) {
  console.log(campaign.ref, campaign.name, campaign.status, campaign.channel);
}

const campaign = outbound.campaign("cmp_ops");
const sequence = await campaign.sequence();

console.log(
  "steps:",
  sequence.steps.map((step) => step.variants.map((v) => v.variantKey).join(""))
);

const stats = await campaign.stats();
const [total] = stats.rows;

console.log("sent:", total?.sent, "replied:", total?.replied);

console.log("delivered:", total?.delivered);

const bySender = await outbound.sender("mbx_1").stats();

console.log("mailbox sent:", bySender.rows[0]?.sent);

// A list's size is counted from the leads that name it.
const lists = await outbound.lists.list();

console.log("list size:", lists.items[0]?.size);

// A reply is an inbound message.
const replies = await outbound.replies.list({ include: ["body"] });

console.log("reply:", replies.items[0]?.category, replies.items[0]?.bodyText);

// No vendor is called, so nothing is spent and nothing is throttled.
console.log("requests:", stats.meta.requests, "evidence:", stats.meta.evidence);
