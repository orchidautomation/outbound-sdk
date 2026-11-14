import { createOutbound, OutboundError } from "outbound-sdk";
import { insights } from "outbound-sdk/insights";
import { memory } from "outbound-sdk/memory";

import { seed } from "./seed.ts";

const outbound = createOutbound({
  adapter: memory({ data: seed, workspaceId: "acme" }),
  plugins: [insights()],
});

// 1. max_replies stopped the read: the list covers part of the replies.
const capped = await outbound.insights.droppedReplies({ max_replies: 3 });

console.log(
  "capped:",
  capped.data.totals.repliesRead,
  capped.meta.complete,
  capped.meta.notes
);

// 2. A tool that can read neither a thread nor a lead's timeline: every
//    reply is counted as unchecked. None is reported as unanswered.
const blind = createOutbound({
  adapter: memory({
    capabilities: { "leads.timeline": false, "messages.byThread": false },
    data: seed,
  }),
  plugins: [insights()],
});

const unchecked = await blind.insights.droppedReplies({});

console.log(
  "cannot check:",
  unchecked.data.totals.dropped,
  unchecked.data.totals.unchecked,
  unchecked.meta.notes
);

// 3. A tool that cannot filter replies by date: read, then filtered here.
const noSince = createOutbound({
  adapter: memory({ capabilities: { "replies.since": false }, data: seed }),
  plugins: [insights()],
});

const filteredHere = await noSince.insights.droppedReplies({});

console.log("no date filter:", filteredHere.meta.notes);

// 4. A date that is not ISO 8601 is refused before any request.
try {
  await outbound.insights.droppedReplies({ since: "last monday" });
} catch (error) {
  if (OutboundError.is(error)) {
    console.log("bad date:", error.code);
  }
}

// 5. An adapter that cannot list replies refuses the whole insight.
const noReplies = createOutbound({
  adapter: memory({ capabilities: { "replies.list": false }, data: seed }),
  plugins: [insights()],
});

try {
  await noReplies.insights.droppedReplies({});
} catch (error) {
  if (OutboundError.is(error)) {
    console.log("no replies:", error.code, "-", error.message);
  }
}
