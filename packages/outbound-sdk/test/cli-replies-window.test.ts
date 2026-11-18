// `outbound replies --since` reads the whole window unless --limit is given
// (OUT-117): the stress test stopped at 50 of about 180 replies.

import assert from "node:assert/strict";
import { test } from "node:test";

import { run } from "../src/cli/index.ts";
import { memory } from "../src/memory/index.ts";
import type { MemoryMessage } from "../src/memory/index.ts";

const HOUR = 3_600_000;
const START = Date.parse("2026-11-01T00:00:00.000Z");

// 180 replies from 90 people in the first half of November, and 10 before it.
const reply = (index: number, sentAt: number): MemoryMessage => ({
  campaignId: "c1",
  direction: "in",
  id: `m${index}`,
  leadId: `l${index % 90}`,
  sentAt: new Date(sentAt).toISOString(),
  threadId: `t${index % 90}`,
});

const MESSAGES = [
  ...Array.from({ length: 180 }, (_, index) =>
    reply(index, START + (index + 1) * HOUR)
  ),
  ...Array.from({ length: 10 }, (_, index) =>
    reply(200 + index, START - (index + 1) * HOUR)
  ),
];

interface Envelope {
  readonly data: { readonly items: readonly unknown[] };
  readonly meta: { readonly complete: boolean; readonly notes: string[] };
}

const replies = async (...flags: string[]) => {
  const out: string[] = [];
  const err: string[] = [];

  const code = await run(["replies", ...flags], {
    adapter: memory({
      data: { campaigns: [{ id: "c1" }], messages: MESSAGES },
    }),
    stderr: (text) => {
      err.push(text);
    },
    stdout: (text) => {
      out.push(text);
    },
  });

  const envelope = JSON.parse(out.join("\n")) as Envelope;

  // A window --limit cut exits 3; a whole one exits 0.
  assert.equal(code, envelope.meta.complete ? 0 : 3, err.join("\n"));

  return {
    envelope,
    err: err.join("\n"),
  };
};

test("replies --since reads every reply in the window", async () => {
  const { envelope, err } = await replies("--since", "2026-11-01");

  assert.equal(envelope.data.items.length, 180);
  assert.equal(envelope.meta.complete, true);
  assert.deepEqual(envelope.meta.notes, [
    "180 messages from 90 people in 90 threads.",
  ]);
  assert.doesNotMatch(err, /Stopped at/u);
});

test("--limit still stops a window, with the note it always had", async () => {
  const { envelope } = await replies("--since", "2026-11-01", "--limit", "50");

  assert.equal(envelope.data.items.length, 50);
  assert.equal(envelope.meta.complete, false);
  assert.equal(
    envelope.meta.notes[0],
    "Stopped at 50 replies; more exist. Pass --limit to read more."
  );
});

test("replies with no window still stops at 50", async () => {
  const { envelope } = await replies();

  assert.equal(envelope.data.items.length, 50);
  assert.equal(envelope.meta.complete, false);
});

test("a window past the ceiling of 2,000 stops there and names it", async () => {
  const out: string[] = [];

  await run(["replies", "--since", "2026-01-01"], {
    adapter: memory({
      data: {
        campaigns: [{ id: "c1" }],
        messages: Array.from({ length: 2001 }, (_, index) =>
          reply(index, START + index * 60_000)
        ),
      },
    }),
    stderr: () => {},
    stdout: (text) => {
      out.push(text);
    },
  });

  const envelope = JSON.parse(out.join("\n")) as Envelope;

  assert.equal(envelope.data.items.length, 2000);
  assert.equal(envelope.meta.complete, false);
  assert.equal(
    envelope.meta.notes[0],
    "Stopped at 2,000 replies, the most a --since window reads without --limit; more exist. Pass --limit to read more, or a later --since."
  );
});
