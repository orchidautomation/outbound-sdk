import assert from "node:assert/strict";
import { mkdtemp, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import { createOutbound, OutboundError } from "outbound-sdk";
import { fixtures } from "outbound-sdk/fixtures";
import { memory } from "outbound-sdk/memory";

import { seed } from "./seed.ts";

const dir = await mkdtemp(path.join(tmpdir(), "outbound-fixtures-"));

// Record. Against a real vendor this is the one run that needs a key.
const recording = createOutbound({
  adapter: memory({ data: seed }),
  plugins: [fixtures({ dir, mode: "record" })],
});

const recorded = await recording.leads.list();

await recording.campaigns.list();

const files = await readdir(dir);

console.log("files:", files.toSorted());

// What was saved, and what the recording run itself got back, is scrubbed.
assert.equal(recorded.items[0]?.email, "person1@example.com");

assert.equal(recorded.items[0]?.company, "Company 1");

console.log("ok - personal data is replaced before it is saved");

// Replay. The adapter here is empty: every answer comes from the files.
const replaying = createOutbound({
  adapter: memory(),
  plugins: [fixtures({ dir, mode: "replay" })],
});

const replayed = await replaying.leads.list();

assert.deepEqual(replayed.items, recorded.items);

assert.equal(replayed.items.length, 5);

console.log("ok - replay answers from disk without the adapter");

// A read that was never recorded fails. It does not fall through to the
// vendor, and different options are a different read.
await assert.rejects(
  replaying.leads.list({ campaignId: "cmp_founders" }),
  (error) => OutboundError.is(error) && error.code === "NotFound"
);

console.log("ok - an unrecorded read is NotFound");

await rm(dir, { recursive: true });
