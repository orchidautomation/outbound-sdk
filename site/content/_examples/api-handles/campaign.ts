import { createOutbound } from "outbound-sdk";
import { demoData, memory } from "outbound-sdk/memory";

const outbound = createOutbound({ adapter: memory({ data: demoData() }) });

// Making a handle sends nothing. Each method on it is one read.
const campaign = outbound.campaign("cmp_founders");

const record = await campaign.get();

console.log(record.name, record.status);

const sequence = await campaign.sequence();

for (const step of sequence.steps) {
  console.log(
    `step ${step.index}: ${step.action}, day +${step.delayDays},`,
    step.variants.map((variant) => variant.subject)
  );
}

const settings = await campaign.settings();

console.log(
  "daily limit:",
  settings.dailyLimit,
  "| stops on reply:",
  settings.stopOnReply,
  "| plain text:",
  settings.plainText
);

// The collections under a campaign have `list` and `listAll`, already
// filtered to the campaign.
const senders = await campaign.senders.list();
const leads = await campaign.leads.listAll().toArray();
const replies = await campaign.replies.list({ include: ["body"] });
const messages = await campaign.messages.list();
const webhooks = await campaign.webhooks.list();
const subsequences = await campaign.subsequences.list();

console.log(
  senders.items.length,
  "senders,",
  leads.length,
  "leads,",
  messages.items.length,
  "messages,",
  replies.items.length,
  "reply,",
  webhooks.items.length,
  "webhooks,",
  subsequences.items.length,
  "subsequences"
);

const stats = await campaign.stats({ by: "day" });

for (const row of stats.rows) {
  console.log(row.date, "sent", row.sent, "replied", row.replied);
}
