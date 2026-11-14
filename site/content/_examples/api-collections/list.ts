import { createOutbound } from "outbound-sdk";
import { demoData, memory } from "outbound-sdk/memory";

const outbound = createOutbound({ adapter: memory({ data: demoData() }) });

// One page. Filters and paging options go in the same object.
const active = await outbound.campaigns.list({ limit: 10, status: "active" });

console.log(
  "active:",
  active.items.map((campaign) => campaign.name)
);

// `since` and `until` are inclusive ISO 8601 dates or timestamps.
const recent = await outbound.leads.list({
  campaignId: "cmp_founders",
  since: "2026-10-03",
});

console.log(
  "added since 3 October:",
  recent.items.map((lead) => lead.email)
);

const senders = await outbound.senders.list({ campaignId: "cmp_agencies" });

console.log(
  "senders on cmp_agencies:",
  senders.items.map((sender) => sender.address)
);

const thread = await outbound.messages.list({ threadId: "thr_1" });

console.log(
  "thr_1:",
  thread.items.map((message) => message.direction)
);

// The collections with no filters.
const lists = await outbound.lists.list();
const tags = await outbound.tags.list();
const blocked = await outbound.blocklist.list();
const webhooks = await outbound.webhooks.list();
const workspaces = await outbound.workspaces.list();

console.log(
  lists.items[0]?.name,
  "|",
  tags.items[0]?.name,
  "|",
  blocked.items[0]?.value,
  "|",
  webhooks.items[0]?.events,
  "|",
  workspaces.items[0]?.name
);
