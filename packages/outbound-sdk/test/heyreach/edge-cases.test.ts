import assert from "node:assert/strict";
import { test } from "node:test";

import { run } from "../../src/cli/index.ts";
import { harness } from "../helpers/adapter-suite.ts";
import { createFetch, json } from "../helpers/http.ts";
import { suite } from "./suite.ts";

// The 2026-11-16 stress test (OUT-128): over 2026-10-01 to 10-03 HeyReach put
// uniqueLeadsContacted at 0 on each day and at 35 for the range.
const RANGE = {
  byDayStats: {
    "2026-10-01T00:00:00Z": {
      messagesSent: 15,
      totalMessageReplies: 3,
      uniqueLeadsContacted: 0,
    },
    "2026-10-02T00:00:00Z": {
      messagesSent: 18,
      totalMessageReplies: 7,
      uniqueLeadsContacted: 0,
    },
    "2026-10-03T00:00:00Z": {
      messagesSent: 0,
      totalMessageReplies: 5,
      uniqueLeadsContacted: 0,
    },
  },
  overallStats: {
    messagesSent: 33,
    totalMessageReplies: 15,
    uniqueLeadsContacted: 35,
  },
};

test("heyreach: a day's contacted is null, and the range's total still reads uniqueLeadsContacted", async () => {
  const { outbound, settle } = harness(suite, () => json(RANGE));
  const range = { from: "2026-10-01", to: "2026-10-03" };

  const days = await settle(outbound.stats({ ...range, by: "day" }));

  assert.deepEqual(
    days.rows.map((row) => [row.date, row.sent, row.contacted]),
    [
      ["2026-10-01", 15, null],
      ["2026-10-02", 18, null],
      ["2026-10-03", 0, null],
    ],
    "0 on every day is not a count of the day"
  );

  const total = await settle(outbound.stats(range));
  assert.equal(total.rows[0]?.contacted, 35);
});

test("heyreach: stats from a date alone run to the end of today, and say so", async () => {
  const { outbound, requests, settle } = harness(suite, () => json(RANGE));
  const before = new Date().toISOString().slice(0, 10);
  const stats = await settle(outbound.stats({ from: "2026-10-01" }));
  const after = new Date().toISOString().slice(0, 10);

  const body = JSON.parse(requests[0]?.body ?? "{}") as Record<string, unknown>;
  assert.equal(body.startDate, "2026-10-01T00:00:00.000Z");
  assert.ok(
    [`${before}T23:59:59.999Z`, `${after}T23:59:59.999Z`].includes(
      String(body.endDate)
    )
  );
  assert.ok(
    stats.meta.notes.some((note) => /read up to today/u.test(note)),
    stats.meta.notes.join(" | ")
  );
});

const cli = async (...argv: string[]) => {
  const out: string[] = [];
  const http = createFetch(() => json({}));

  const code = await run(argv, {
    adapter: suite.make(),
    fetch: http.fetch,
    stderr: () => {},
    stdout: (text) => {
      out.push(text);
    },
  });

  return {
    code,
    envelope: JSON.parse(out.join("\n")) as {
      error: { code: string; message: string };
    },
    requests: http.requests.length,
  };
};

test("heyreach: outbound tool names why a tool this instance leaves out cannot run, before any request", async () => {
  const hidden = await cli("tool", "winning_steps");

  assert.equal(hidden.code, 1);
  assert.equal(hidden.envelope.error.code, "Unsupported");
  assert.match(
    hidden.envelope.error.message,
    /^winning_steps is not available: the heyreach adapter does not support stats\.byStep/u
  );
  assert.equal(hidden.requests, 0);

  const insight = await cli("tool", "step_funnel");
  assert.equal(insight.envelope.error.code, "Unsupported");
  assert.match(insight.envelope.error.message, /stats\.byStep/u);

  const unknown = await cli("tool", "no_such_tool");
  assert.equal(unknown.envelope.error.code, "Invalid");
  assert.match(unknown.envelope.error.message, /Unknown tool "no_such_tool"/u);
});
