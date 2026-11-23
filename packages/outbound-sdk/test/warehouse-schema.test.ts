// OUT-167: a warehouse load with a stable schema. Exported rows have every
// field of their record whichever vendor filled them, the DuckDB table and
// JSON Schema come from the record's Zod schema, and sparse daily stats can be
// made dense without a missing day reading as a reported one.

import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { after, test } from "node:test";

import {
  duckdbTable,
  exporter,
  recordColumns,
  recordJsonSchema,
} from "../src/exporter/index.ts";
import { createOutbound, fillDays, OutboundError } from "../src/index.ts";
import type { MetricRow, Reply } from "../src/index.ts";
import { harness } from "./helpers/adapter-suite.ts";
import { suite as heyreachSuite } from "./heyreach/suite.ts";
import { CAMPAIGN, suite as instantlySuite } from "./instantly/suite.ts";

const dir = mkdtempSync(path.join(tmpdir(), "outbound-warehouse-"));

after(() => rmSync(dir, { force: true, recursive: true }));

const key = (row: MetricRow) => `${row.date}/${row.scopeRef.split(":").at(-1)}`;

const invalid = (error: unknown) =>
  OutboundError.is(error) && error.code === "Invalid";

/** Both vendors' replies, as their adapters map the documented payloads. */
const replies = async (): Promise<Reply[]> => {
  const all: Reply[] = [];

  for (const suite of [instantlySuite, heyreachSuite]) {
    const { outbound, settle } = harness(suite);
    all.push(...(await settle(outbound.replies.list())).items);
  }

  return all;
};

const lines = (file: string) =>
  readFileSync(file, "utf-8")
    .trim()
    .split("\n")
    .map((line) => JSON.parse(line) as Record<string, unknown>);

test("export with record writes every field of the record, null where a vendor leaves it out", async () => {
  const items = await replies();
  // HeyReach replies carry no leadEmail: LinkedIn has no address.
  const heyreachReply = items.find((each) => each.provider === "heyreach");
  assert.ok(heyreachReply);
  assert.equal("leadEmail" in heyreachReply, false);

  const outbound = createOutbound({
    adapter: instantlySuite.make(),
    plugins: [exporter()],
  });

  const file = path.join(dir, "replies.jsonl");

  const result = await outbound.export(items.toReversed(), {
    record: "reply",
    to: file,
  });

  assert.deepEqual(result.columns, recordColumns("reply"));
  assert.ok(result.columns.includes("leadEmail"));
  assert.equal(result.columns.includes("raw"), false);

  for (const row of lines(file)) {
    assert.deepEqual(Object.keys(row), result.columns);
  }

  const heyreachRow = lines(file).find((row) => row.provider === "heyreach");
  assert.equal(heyreachRow?.leadEmail, null);

  // Without record the columns follow the first record, so they drift.
  const inferred = await outbound.export(items.toReversed(), {
    to: path.join(dir, "inferred.jsonl"),
  });

  assert.equal(inferred.columns.includes("leadEmail"), false);
});

test("an empty export with record still writes the record's CSV header", async () => {
  const outbound = createOutbound({
    adapter: instantlySuite.make(),
    plugins: [exporter()],
  });

  const file = path.join(dir, "none.csv");
  await outbound.export([], { record: "metricRow", to: file });
  assert.equal(
    readFileSync(file, "utf-8"),
    `${recordColumns("metricRow").join(",")}\n`
  );
});

test("recordJsonSchema requires every column and makes a field a vendor may leave out nullable", () => {
  const schema = recordJsonSchema("reply");

  assert.deepEqual(schema.required, recordColumns("reply"));
  assert.equal(schema.additionalProperties, false);
  assert.deepEqual(schema.properties.leftCompany?.type, ["boolean", "null"]);
  assert.equal("raw" in schema.properties, false);

  // raw is recursive JSON: its $ref must resolve within the document.
  const withRaw = recordJsonSchema("reply", { includeRaw: true });
  const reference = withRaw.properties.raw?.$ref ?? "";
  assert.match(reference, /^#\/\$defs\//u);
  assert.ok(reference.slice("#/$defs/".length) in (withRaw.$defs ?? {}));
});

// Loading the table with COPY is run by site/content/_examples/duckdb/typed.ts,
// which npm test runs: DuckDB's native bindings cannot be bundled for the
// Workers run of this file.
test("duckdbTable types each column from the record's schema, an all-null column included", () => {
  const ddl = duckdbTable("reply", { table: "replies" });
  const columns = ddl.split("\n").slice(1, -1);

  assert.ok(ddl.startsWith('CREATE TABLE IF NOT EXISTS "replies" ('));
  assert.deepEqual(
    columns.map((line) => /"(?<name>[^"]+)"/u.exec(line)?.groups?.name),
    recordColumns("reply")
  );
  assert.ok(ddl.includes('  "leftCompany" BOOLEAN,'));
  assert.ok(ddl.includes('  "sentAt" TIMESTAMPTZ,'));
  assert.ok(ddl.includes('  "stepIndex" BIGINT,'));
  assert.ok(ddl.includes('  "ref" VARCHAR NOT NULL,'));

  // A count no vendor has filled yet is still a number.
  assert.ok(duckdbTable("metricRow").includes('  "meetingsBooked" DOUBLE,'));
  assert.ok(duckdbTable("metricRow").includes('  "tracking" JSON,'));
});

test("duckdbTable refuses a name that is not a record", () => {
  assert.throws(
    // @ts-expect-error -- not a record name.
    () => duckdbTable("leadz"),
    (error) => OutboundError.is(error) && error.code === "Invalid"
  );
});

test("fillDays makes HeyReach's sparse campaign days dense, a missing day null by default", async () => {
  const { outbound, settle } = harness(heyreachSuite);

  const sparse = (
    await settle(outbound.stats({ by: "day", scope: "campaign" }))
  ).rows;

  // Seen live and in the documented payload: a campaign with no activity on
  // a day has no row for it.
  assert.deepEqual(sparse.map(key), [
    "2024-12-17/274079",
    "2024-12-17/274080",
    "2024-12-18/274079",
  ]);

  const dense = fillDays(sparse, { from: "2024-12-17", to: "2024-12-19" });
  assert.deepEqual(dense.map(key), [
    "2024-12-17/274079",
    "2024-12-17/274080",
    "2024-12-18/274079",
    "2024-12-18/274080",
    "2024-12-19/274079",
    "2024-12-19/274080",
  ]);

  const filled = dense.filter((row) => !sparse.includes(row));
  assert.ok(
    filled.every(
      (row) =>
        row.evidence === "derived" &&
        row.sent === null &&
        row.timezone === "UTC"
    )
  );
  assert.ok(
    sparse.every((row) => dense.includes(row)),
    "reported rows are kept as they are"
  );
});

test("fillDays with zero sets 0 only for counts the scope reports, and keeps the rest null", () => {
  const scope = {
    contentHash: null,
    evidence: "exact" as const,
    provider: "heyreach",
    schemaVersion: 1 as const,
    scope: "campaign" as const,
    scopeRef: "heyreach:ws:1",
    stepIndex: null,
    timezone: "UTC",
    variantKey: null,
    workspaceId: "ws",
  };

  const day = (date: string, sent: number): MetricRow => ({
    ...scope,
    bounced: null,
    clicked: null,
    clickedTotal: null,
    connectionsAccepted: 3,
    connectionsSent: null,
    contacted: null,
    date,
    delivered: null,
    inmailsSent: null,
    opened: null,
    openedTotal: null,
    positive: null,
    replied: 1,
    repliedAuto: null,
    sent,
    unsubscribed: null,
  });

  const [first, gap, last] = fillDays(
    [day("2026-11-01", 5), day("2026-11-03", 7)],
    {
      fill: "zero",
      from: "2026-11-01",
      to: "2026-11-03",
    }
  );

  assert.equal(first?.sent, 5);
  assert.equal(last?.sent, 7);
  assert.deepEqual(
    [
      gap?.date,
      gap?.sent,
      gap?.replied,
      gap?.connectionsAccepted,
      gap?.opened,
      gap?.evidence,
    ],
    ["2026-11-02", 0, 0, 0, null, "derived"]
  );
});

test("fillDays refuses totals, bad days and a range that runs backwards", async () => {
  const { outbound, settle } = harness(instantlySuite);
  const total = (await settle(outbound.campaign(CAMPAIGN).stats())).rows;

  assert.throws(
    () => fillDays(total, { from: "2026-11-01", to: "2026-11-02" }),
    invalid
  );
  assert.throws(
    () => fillDays([], { from: "11/01/2026", to: "2026-11-02" }),
    invalid
  );
  assert.throws(
    () => fillDays([], { from: "2026-02-30", to: "2026-03-02" }),
    invalid,
    "a day that does not exist is refused, not moved to March"
  );
  assert.throws(
    () => fillDays([], { from: "2026-11-03", to: "2026-11-02" }),
    invalid
  );
  assert.deepEqual(fillDays([], { from: "2026-11-01", to: "2026-11-02" }), []);
});
