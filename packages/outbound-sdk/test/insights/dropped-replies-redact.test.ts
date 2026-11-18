// Under redact, a combined instance reads conversations by the lead's
// timeline, so the lead ref reaches the vendor as a query filter. The redact
// plugin must put the real value back there too, and one failed conversation
// read must leave that reply unchecked, not sink the report (OUT-133).

import assert from "node:assert/strict";
import { test } from "node:test";

import { combine } from "../../src/combine/index.ts";
import { createOutbound, OutboundError } from "../../src/index.ts";
import type { OutboundPlugin } from "../../src/index.ts";
import { insights } from "../../src/insights/index.ts";
import { memory } from "../../src/memory/index.ts";
import type { MemoryData } from "../../src/memory/index.ts";
import { redact } from "../../src/redact/index.ts";
import { EMAIL_TOOL, LINKEDIN_TOOL, NOW, PROFILE } from "./helpers.ts";

/** The tool's data with one lead's id changed, on the lead and its messages. */
const withLeadId = (
  data: MemoryData,
  from: string,
  to: string
): MemoryData => ({
  ...data,
  leads: (data.leads ?? []).map((lead) =>
    lead.id === from ? { ...lead, id: to } : lead
  ),
  messages: (data.messages ?? []).map((message) =>
    message.leadId === from ? { ...message, leadId: to } : message
  ),
});

// Some vendors use the address or the profile as the lead's id, which redact masks in the ref.
const EMAIL_IDS = withLeadId(EMAIL_TOOL, "l1", "person1@example.com");
const LINKEDIN_IDS = withLeadId(LINKEDIN_TOOL, "p1", PROFILE);

const isTimelineRead = (operation: unknown): boolean =>
  JSON.stringify(operation).includes('"leadId"');

const readsTimeline = (seen: string): boolean => seen.includes('"leadId"');

/** Records what reaches the adapter, inside redact, and fails a read with `error`. */
const spy = (error?: OutboundError) => {
  const seen: string[] = [];

  const plugin: OutboundPlugin = {
    name: "spy",
    wrap: (operation, next) => {
      seen.push(JSON.stringify(operation));

      if (error !== undefined && isTimelineRead(operation)) {
        throw error;
      }

      return next(operation);
    },
  };

  return { plugin, seen };
};

const build = (reads: ReturnType<typeof spy>) =>
  createOutbound({
    adapter: combine([
      memory({ data: EMAIL_IDS, name: "mailtool", workspaceId: "agency" }),
      memory({ data: LINKEDIN_IDS, name: "lntool", workspaceId: "agency" }),
    ]),
    plugins: [redact({}), reads.plugin, insights()],
  });

test("under redact, dropped_replies on a combined instance sends no token to the adapter", async () => {
  const reads = spy();

  const result = await build(reads).insights.droppedReplies(
    { since: "2026-11-01" },
    { now: NOW }
  );

  assert.deepEqual(
    reads.seen
      .filter(readsTimeline)
      .map((each) => JSON.parse(each).query.leadId),
    ["mailtool:agency:person1@example.com", `lntool:agency:${PROFILE}`]
  );
  assert.deepEqual(
    reads.seen.filter((each) => each.includes("redacted:")),
    []
  );
  assert.deepEqual(
    result.data.dropped.map((each) => [
      each.hoursWaiting,
      each.checkedBy,
      each.channel,
    ]),
    [[267, "timeline", "linkedin"]]
  );
  assert.equal(result.data.totals.answered, 1);
  assert.equal(result.data.totals.unchecked, 0);
});

test("a conversation that cannot be read is counted unchecked, with a note", async () => {
  const reads = spy(new OutboundError("Invalid", "The vendor refused it."));

  const result = await build(reads).insights.droppedReplies(
    { since: "2026-11-01" },
    { now: NOW }
  );

  assert.deepEqual(result.data.dropped, []);
  assert.equal(result.data.totals.dropped, 0);
  assert.ok(result.data.totals.unchecked > 0);
  assert.equal(
    result.data.totals.answered + result.data.totals.unchecked,
    result.data.totals.conversations
  );
  assert.ok(
    result.meta.notes.some((note) =>
      /could not be read, so .+ counted in totals\.unchecked, not as dropped \(Invalid\)/u.test(
        note
      )
    ),
    result.meta.notes.join("\n")
  );
});

// OUT-156: a cap keeps what was read, and never passes a stopped read off
// as an answered or dropped conversation.
test("a request cap stops dropped_replies with what it read, marked incomplete, never as answered", async () => {
  const reads = spy(
    new OutboundError("RateLimited", "The run cap was reached.", {
      limit: "run",
    })
  );

  const result = await build(reads).insights.droppedReplies(
    { since: "2026-11-01" },
    { now: NOW }
  );

  assert.equal(result.meta.complete, false);
  assert.equal(result.data.totals.dropped, 0);
  assert.equal(result.data.totals.answered, 0);
  assert.equal(result.data.totals.unchecked, result.data.totals.conversations);
  assert.ok(
    result.meta.notes.some((note) =>
      note.startsWith("A request cap stopped the run")
    ),
    result.meta.notes.join("\n")
  );
});
