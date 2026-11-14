import { memoryDedupeStore, parse } from "outbound-sdk/webhooks";
import type { DedupeStore } from "outbound-sdk/webhooks";

import { payload, post } from "./fixtures.ts";

const reply = payload("instantly", "webhook.reply_received.json");
const sent = payload("instantly", "webhook.email_sent.json");

// The same payload delivered twice gives the same id.
const [first] = await parse(post(reply), { provider: "instantly" });
const [again] = await parse(post(reply), { provider: "instantly" });

console.log(first?.id);

console.log("same id on redelivery:", first?.id === again?.id);

// Without a store, a redelivery is returned again.
console.log("no store, second delivery:", again === undefined ? 0 : 1, "event");

// With a store, an event already claimed is dropped.
const count = async (body: string, dedupe: DedupeStore): Promise<number> => {
  const events = await parse(post(body), { dedupe, provider: "instantly" });

  return events.length;
};

const store = memoryDedupeStore();

console.log("first delivery:", await count(reply, store));

console.log("redelivery:", await count(reply, store));

console.log("another event:", await count(sent, store));

// The store is one method. This one keeps ids in a Map; yours would use a
// database or Redis, where recording the id and testing it is one atomic step.
const seen = new Map<string, number>();

const custom: DedupeStore = {
  claim: (id) => {
    const fresh = !seen.has(id);

    if (fresh) {
      seen.set(id, Date.now());
    }

    return Promise.resolve(fresh);
  },
};

console.log(
  "custom store:",
  await count(reply, custom),
  await count(reply, custom)
);
