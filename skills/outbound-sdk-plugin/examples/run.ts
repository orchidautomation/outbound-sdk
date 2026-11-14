// Tests the plugin in read-log.ts the way a plugin should be tested: on the
// in-memory adapter, including one that declares less than a vendor would.
import { createOutbound, OutboundError } from "outbound-sdk";
import { demoData, memory } from "outbound-sdk/memory";

import { readLog } from "./read-log.ts";
import type { ReadLogEntry } from "./read-log.ts";

const entries: ReadLogEntry[] = [];

const keep = (entry: ReadLogEntry): void => {
  entries.push(entry);
};

const outbound = createOutbound({
  adapter: memory({ data: demoData() }),
  plugins: [readLog({ sink: keep })],
});

const campaigns = await outbound.campaigns.list();

console.log(campaigns.items.length, "campaigns;", entries);

console.log("typed extension:", outbound.readLog.count());

// A sink that throws does not fail the read.
const broken = createOutbound({
  adapter: memory({ data: demoData() }),
  plugins: [
    readLog({
      sink: () => {
        throw new Error("the log is down");
      },
    }),
  ],
});

const senders = await broken.senders.list();

console.log(
  senders.items.length,
  "senders;",
  broken.readLog.failed(),
  "failed"
);

// A read the adapter cannot serve is refused before any plugin runs.
const narrow = createOutbound({
  adapter: memory({
    capabilities: { "replies.list": false },
    data: demoData(),
  }),
  plugins: [readLog({ sink: keep })],
});

try {
  await narrow.replies.list();
} catch (error) {
  if (error instanceof OutboundError) {
    console.log(error.code, "and the log saw", narrow.readLog.count(), "reads");
  }
}

// The same plugin twice is a name clash, refused when the instance is built.
try {
  createOutbound({
    adapter: memory(),
    plugins: [readLog({ sink: keep }), readLog({ sink: keep })],
  });
} catch (error) {
  if (error instanceof OutboundError) {
    console.log(error.code, error.message);
  }
}
