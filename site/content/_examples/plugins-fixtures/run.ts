import { mkdtemp, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import { createOutbound, OutboundError } from "outbound-sdk";
import { fixtures } from "outbound-sdk/fixtures";
import { memory } from "outbound-sdk/memory";

import { seed } from "../plugins-index/seed.ts";

// In a project this is a folder you commit, such as test/fixtures.
const dir = await mkdtemp(path.join(tmpdir(), "outbound-fixtures-"));

// 1. Record. The read goes to the adapter and the answer is saved, scrubbed.
const recording = createOutbound({
  adapter: memory({ data: seed, workspaceId: "agency" }),
  plugins: [fixtures({ dir, mode: "record" })],
});

const recorded = await recording.campaign("cmp_founders").leads.list();

await recording.campaigns.list();

const files = await readdir(dir);

console.log("files:", files.toSorted());

// What record mode returns is what it saved: the scrubbed records.
for (const lead of recorded.items) {
  console.log(
    lead.email,
    "|",
    lead.firstName,
    lead.lastName,
    "|",
    lead.company
  );
}

// 2. Replay. This adapter holds no data, so the answers come from disk.
const replaying = createOutbound({
  adapter: memory({ workspaceId: "agency" }),
  plugins: [fixtures({ dir, mode: "replay" })],
});

const replayed = await replaying.campaign("cmp_founders").leads.list();

console.log(
  "replayed:",
  replayed.items.length,
  "leads,",
  replayed.items[0]?.email
);

const campaigns = await replaying.campaigns.list();

console.log(campaigns.items.map((item) => item.name));

// 3. A read that was never recorded fails. Replay never calls the adapter.
try {
  await replaying.senders.list();
} catch (error) {
  if (OutboundError.is(error)) {
    console.log(`${error.code}: ${error.message}`);
  }
}

// A different question is a different file, so this was not recorded either.
try {
  await replaying.campaigns.list({ status: "paused" });
} catch (error) {
  if (OutboundError.is(error)) {
    console.log(`${error.code}: ${error.message}`);
  }
}

await rm(dir, { force: true, recursive: true });
