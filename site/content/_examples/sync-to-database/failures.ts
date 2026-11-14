import { OutboundError } from "outbound-sdk";
import type { Campaign, Lead, Reply } from "outbound-sdk";
import { memory } from "outbound-sdk/memory";

import {
  openDatabase,
  upsertCampaigns,
  upsertLeads,
  upsertReplies,
} from "./database.ts";
import { seed } from "./seed.ts";
import { syncing } from "./sync-all.ts";

const db = openDatabase();

const outbound = syncing(
  memory({ data: seed, pageSize: 2, workspaceId: "acme" }),
  db
);

// 1. `maxPages` stops a run early. It is not a failure: the result says the
//    run is incomplete, and the next run continues from the checkpoint.
const capped = await outbound.sync.run<Lead>("leads", {
  maxPages: 1,
  onPage: (leads) => upsertLeads(db, leads),
});

console.log(`capped: complete ${capped.complete}, ${capped.records} records`);

const rest = await outbound.sync.run<Lead>("leads", {
  onPage: (leads) => upsertLeads(db, leads),
});

console.log(`next run: resumed ${rest.resumed}, ${rest.records} records`);

// 2. A collection the adapter cannot list is refused before any request.
const noReplies = syncing(
  memory({ capabilities: { "replies.list": false }, data: seed }),
  db
);

try {
  await noReplies.sync.run<Reply>("replies", {
    onPage: (replies) => upsertReplies(db, replies),
  });
} catch (error) {
  if (OutboundError.is(error)) {
    console.log("no replies:", error.code, "-", error.message);
  }
}

// 3. A failed vendor call ends the run with the SDK's error. The checkpoint
//    stays where the last written page left it.
const rejected = syncing(
  {
    ...memory({ data: seed, workspaceId: "acme" }),
    listCampaigns: () =>
      Promise.reject(
        new OutboundError("Unauthorized", "The key was rejected", {
          status: 401,
        })
      ),
  },
  db
);

try {
  await rejected.sync.run<Campaign>("campaigns", {
    onPage: (campaigns) => upsertCampaigns(db, campaigns),
  });
} catch (error) {
  if (OutboundError.is(error)) {
    console.log("bad key:", error.code, "permanent", error.permanent);
  }
}

// 4. `reset` forgets a checkpoint, so the next run reads everything again.
await outbound.sync.reset("leads");

const again = await outbound.sync.run<Lead>("leads", {
  onPage: (leads) => upsertLeads(db, leads),
});

console.log(
  `after reset: ${again.records} records, lower bound ${again.since ?? "none"}`
);
