import { createOutbound } from "outbound-sdk";
import { demoData, memory } from "outbound-sdk/memory";

const outbound = createOutbound({ adapter: memory({ data: demoData() }) });

// Bodies are left out unless you ask for them.
const plain = await outbound.replies.list({ category: "positive" });

console.log("without include:", plain.items[0]?.bodyText);

const withBody = await outbound.replies.list({
  category: "positive",
  include: ["body"],
});

console.log("with include:", withBody.items[0]?.bodyText);
