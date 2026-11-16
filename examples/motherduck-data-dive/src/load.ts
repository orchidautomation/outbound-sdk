// Reads every workspace through outbound-sdk, streams each table to a JSON
// Lines file with the SDK's exporter, and loads those files into DuckDB. With
// MOTHERDUCK_TOKEN set it then copies the tables to MotherDuck, so the same
// SQL runs in the MotherDuck UI.
//
//   node src/load.ts            every tool whose API key is set
//   node src/load.ts --demo     the made-up agency in demo.ts
//   node src/load.ts --days 30  how far back stats and replies go (default 60)

import { mkdir, readFile } from "node:fs/promises";
import path from "node:path";
import { parseArgs } from "node:util";

import { DuckDBInstance } from "@duckdb/node-api";
import type { DuckDBConnection } from "@duckdb/node-api";

import { pickSources } from "./sources.ts";
import type { Source } from "./sources.ts";
import { TABLES } from "./tables.ts";
import type { Range, Table } from "./tables.ts";

const ROOT = path.resolve(import.meta.dirname, "..");
const STAGING = path.join(ROOT, "staging");
const DAY = 86_400_000;

const { values: flags } = parseArgs({
  options: {
    days: { default: "60", type: "string" },
    db: { default: path.join(ROOT, "outbound.duckdb"), type: "string" },
    demo: { default: false, type: "boolean" },
  },
});

const sqlString = (text: string): string => `'${text.replaceAll("'", "''")}'`;

const lastDays = (days: number): Range => {
  const today = Math.floor(Date.now() / DAY) * DAY;

  const day = (offset: number) =>
    new Date(today - offset * DAY).toISOString().slice(0, 10);

  return { from: day(days), to: day(1) };
};

/**
 * Every source's rows for one table, one source after another.
 *
 * @yields {object} A row of that table.
 */
const allRows = async function* allRows(
  table: Table,
  sources: readonly Source[],
  range: Range
) {
  for (const source of sources) {
    yield* table.rows(source, range);
  }
};

const stage = async (
  table: Table,
  sources: readonly Source[],
  range: Range
): Promise<string> => {
  const file = path.join(STAGING, `${table.name}.jsonl`);
  const [first] = sources;

  if (first === undefined) {
    throw new Error("No workspace to read");
  }

  // Any instance's exporter takes any iterable; the rows carry their own
  // provider and workspace.
  const { rows } = await first.export(allRows(table, sources, range), {
    columns: Object.keys(table.columns),
    to: file,
  });

  console.log(`  ${table.name.padEnd(14)} ${rows} rows`);

  return file;
};

const loadTable = async (
  connection: DuckDBConnection,
  table: Table,
  file: string
): Promise<void> => {
  const columns = Object.entries(table.columns)
    .map(([name, type]) => `${sqlString(name)}: ${sqlString(type)}`)
    .join(", ");

  await connection.run(
    `CREATE OR REPLACE TABLE ${table.name} AS
       SELECT * FROM read_json(${sqlString(file)},
         format = 'newline_delimited', columns = {${columns}})`
  );
};

const runModels = async (connection: DuckDBConnection): Promise<void> => {
  const models = await readFile(path.join(ROOT, "sql", "models.sql"), "utf-8");
  await connection.run(models);
};

const pushToMotherDuck = async (
  connection: DuckDBConnection,
  local: string
): Promise<string> => {
  const database = process.env.MOTHERDUCK_DATABASE ?? "outbound_sdk";

  // The token is read from MOTHERDUCK_TOKEN by the extension itself.
  await connection.run("ATTACH 'md:'");
  await connection.run(`CREATE DATABASE IF NOT EXISTS ${database}`);

  for (const table of [...TABLES.map(({ name }) => name), "load_info"]) {
    // oxlint-disable-next-line no-await-in-loop -- one connection runs one statement at a time
    await connection.run(
      `CREATE OR REPLACE TABLE ${database}.main.${table} AS
         FROM ${local}.main.${table}`
    );
  }

  await connection.run(`USE ${database}`);
  await runModels(connection);

  return database;
};

const main = async (): Promise<void> => {
  const days = Math.trunc(Number(flags.days));
  const range = lastDays(days);
  const { demo, sources } = await pickSources(flags.demo);

  console.log(
    demo
      ? "Reading the made-up demo agency (no API key set, or --demo)."
      : `Reading ${sources.length} live workspace(s), read-only.`
  );
  console.log(`Stats and replies from ${range.from} to ${range.to}.`);

  await mkdir(STAGING, { recursive: true });

  const files = new Map<string, string>();

  for (const table of TABLES) {
    // oxlint-disable-next-line no-await-in-loop -- tables are read in turn so one vendor budget is not split across them
    files.set(table.name, await stage(table, sources, range));
  }

  const instance = await DuckDBInstance.create(flags.db);
  const connection = await instance.connect();

  for (const table of TABLES) {
    // oxlint-disable-next-line no-await-in-loop -- one connection runs one statement at a time
    await loadTable(connection, table, files.get(table.name) ?? "");
  }

  // What the report says about where its numbers came from.
  await connection.run(
    `CREATE OR REPLACE TABLE load_info AS
       SELECT ${demo} AS demo, ${sources.length} AS workspaces,
         now() AS loaded_at, DATE ${sqlString(range.from)} AS range_from,
         DATE ${sqlString(range.to)} AS range_to`
  );
  await runModels(connection);
  console.log(`Loaded into ${path.relative(process.cwd(), flags.db)}.`);

  if ((process.env.MOTHERDUCK_TOKEN ?? "") !== "") {
    const local = path.basename(flags.db).replace(/\.duckdb$/u, "");
    const database = await pushToMotherDuck(connection, local);
    console.log(`Copied to MotherDuck as md:${database}.`);
  }

  connection.closeSync();
};

await main();
