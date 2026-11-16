// Runs every query in sql/report/ against the loaded database and writes
// report.html: one page, no server, with each chart's SQL beside it.
//
//   node src/report.ts                 reads outbound.duckdb
//   node src/report.ts --db other.duckdb

import { readdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { parseArgs } from "node:util";

import { DuckDBInstance } from "@duckdb/node-api";
import type { Json } from "@duckdb/node-api";

const ROOT = path.resolve(import.meta.dirname, "..");
const QUERIES = path.join(ROOT, "sql", "report");

const { values: flags } = parseArgs({
  options: {
    db: { default: path.join(ROOT, "outbound.duckdb"), type: "string" },
    out: { default: path.join(ROOT, "report.html"), type: "string" },
  },
});

const main = async (): Promise<void> => {
  const instance = await DuckDBInstance.create(flags.db, {
    access_mode: "READ_ONLY",
  });

  const connection = await instance.connect();

  const listed = await readdir(QUERIES);

  const files = listed.filter((file) => file.endsWith(".sql")).toSorted();

  const results = await Promise.all(
    files.map(async (file) => {
      const sql = await readFile(path.join(QUERIES, file), "utf-8");

      return { file, sql };
    })
  );

  const data: Record<string, { sql: string; rows: Record<string, Json>[] }> =
    {};

  for (const { file, sql } of results) {
    // oxlint-disable-next-line no-await-in-loop -- one connection runs one statement at a time
    const reader = await connection.runAndReadAll(sql);

    // BIGINT comes back as a string here, so no count loses precision.
    const rows = reader.getRowObjectsJson();

    data[file.replace(/^\d+-/u, "").replace(/\.sql$/u, "")] = {
      rows,
      sql: sql.trim(),
    };
  }

  connection.closeSync();

  const template = await readFile(
    path.join(ROOT, "report", "template.html"),
    "utf-8"
  );

  // `<` is escaped so no value can close the script tag it sits in.
  const json = JSON.stringify(data).replaceAll("<", String.raw`<`);
  const placeholder = /\/\*__REPORT_DATA__\*\/\s*\{\}/u;

  if (!placeholder.test(template)) {
    throw new Error(
      "report/template.html has no /*__REPORT_DATA__*/ {} marker"
    );
  }

  await writeFile(
    flags.out,
    template.replace(placeholder, () => json)
  );
  console.log(`Wrote ${path.relative(process.cwd(), flags.out)}.`);
};

await main();
