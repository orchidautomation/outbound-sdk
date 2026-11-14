import { createOutbound } from "outbound-sdk";
import { demoData, memory } from "outbound-sdk/memory";

const outbound = createOutbound({ adapter: memory({ data: demoData() }) });

const lead = outbound.lead("lead_1");

const record = await lead.get();

console.log(record.email, record.status, record.interest);

// Every message to and from the lead, oldest first, every page collected.
const timeline = await lead.timeline({ include: ["body"] });

for (const message of timeline.items) {
  console.log(message.sentAt, message.direction, "-", message.bodyText);
}

// A thread, by the `threadId` a message carries.
const [first] = timeline.items;
const thread = await outbound.thread(first?.threadId ?? "").messages();

console.log("thread:", thread.items.length, "messages");

// A saved list has one collection under it.
const onList = await outbound.list("lst_founders").leads.list();

console.log(
  "on the list:",
  onList.items.map((item) => item.email)
);
