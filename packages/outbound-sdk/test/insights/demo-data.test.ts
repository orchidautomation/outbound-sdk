// demoData() counts its dates back from the moment it is built for, so the
// reports over the last days find data on whatever day someone tries it.

import assert from "node:assert/strict";
import { test } from "node:test";

import { createOutbound } from "../../src/index.ts";
import { insights } from "../../src/insights/index.ts";
import { demoData, memory } from "../../src/memory/index.ts";

// A year after the data was first written, and at an awkward hour.
const LATER = Date.parse("2027-11-20T00:30:00.000Z");

const instanceAt = (now: number) =>
  createOutbound({
    adapter: memory({ data: demoData({ now }) }),
    plugins: [insights()],
  });

test("a seven-day client report over the demo data has both periods", async () => {
  const report = await instanceAt(LATER).insights.clientReport(
    {},
    { now: LATER }
  );

  const { current, previous } = report.data.totals;

  assert.equal(current.sent, 150);
  assert.equal(previous.sent, 145);
  assert.notEqual(report.data.totals.verdict, "unknown");
});

test("dropped replies over the demo data reads the waiting reply", async () => {
  const dropped = await instanceAt(LATER).insights.droppedReplies(
    {},
    { now: LATER }
  );

  assert.equal(dropped.data.totals.repliesRead, 1);
  assert.equal(dropped.data.dropped.length, 1);
});

test("the demo data is the same on every call for the same moment", () => {
  assert.deepEqual(
    demoData({ now: "2026-11-14T12:00:00.000Z" }),
    demoData({ now: new Date("2026-11-14T18:00:00.000Z") })
  );

  assert.notDeepEqual(
    demoData({ now: "2026-11-14T12:00:00.000Z" }),
    demoData({ now: "2026-11-15T12:00:00.000Z" })
  );
});

test("the demo data's dates sit before the moment it is built for", () => {
  const data = demoData({ now: LATER });

  const times = [
    ...(data.messages ?? []).map((message) => message.sentAt),
    ...(data.leads ?? []).map((lead) => lead.createdAt),
    ...(data.stats ?? []).map((row) => `${row.date}T00:00:00.000Z`),
  ];

  assert.ok(times.length > 0);

  for (const time of times) {
    assert.ok(time !== undefined && Date.parse(time) < LATER, String(time));
  }
});

test("demoData refuses a now that is not a date", () => {
  assert.throws(() => demoData({ now: "next tuesday" }), TypeError);
});
