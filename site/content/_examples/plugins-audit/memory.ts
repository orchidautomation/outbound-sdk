import { createOutbound } from "outbound-sdk";
import { audit } from "outbound-sdk/audit";
import { memory } from "outbound-sdk/memory";

import { seed } from "../plugins-index/seed.ts";

const outbound = createOutbound({
  adapter: memory({ data: seed, workspaceId: "agency" }),
  plugins: [
    audit({
      // A sink that throws is ignored. The read below still succeeds.
      sink: (entry) => {
        if (entry.type === "call") {
          console.log(
            `${entry.at} ${entry.operation}: ${entry.records} records, ${entry.requests} requests, error ${entry.error}`
          );
        }

        throw new Error("the log disk is full");
      },
    }),
  ],
});

// One SDK call can be several operations: a campaign's stats and its leads.
await outbound.campaign("cmp_founders").stats();

const leads = await outbound.campaign("cmp_founders").leads.list();

console.log("the read returned", leads.items.length, "leads");
