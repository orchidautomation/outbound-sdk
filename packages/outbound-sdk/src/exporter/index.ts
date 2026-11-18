// outbound-sdk/exporter: streams records to a CSV or JSON Lines file, or to
// a writer you supply for another format such as Parquet or DuckDB. Rows are
// written as they arrive, so a large export never sits in memory.

import { open } from "node:fs/promises";

import { OutboundError } from "../internal/errors.ts";
import { isJsonObject, toJson } from "../internal/json.ts";
import type { Json, JsonObject } from "../internal/json.ts";
import type { OutboundPlugin } from "../internal/outbound/plugins.ts";
import { recordColumns } from "./schema.ts";
import type { RecordName } from "./schema.ts";

export { duckdbTable, recordColumns, recordJsonSchema } from "./schema.ts";

export type {
  ColumnSchema,
  DuckdbTableOptions,
  RecordName,
  RecordSchemaOptions,
  RowJsonSchema,
} from "./schema.ts";

/**
 * Receives rows one at a time. Implement it to write Parquet, DuckDB or
 * anything else. A row holds the export's columns and nothing else, and
 * `close` is called once, also when the source fails or yields nothing.
 */
export interface RowWriter {
  readonly write: (row: JsonObject) => Promise<void>;
  readonly close: () => Promise<void>;
}

export interface ExportOptions {
  /** A file path ending in `.csv` or `.jsonl`, or a writer. */
  readonly to: RowWriter | string;
  /**
   * The columns to write, in order. Defaults to every field of `record`,
   * or else the first record's fields, without `raw`.
   */
  readonly columns?: readonly string[] | undefined;
  /**
   * The record the source yields, such as `reply` or `metricRow`. Every
   * row then has every field of that record, `null` where a vendor leaves
   * one out, so files from different vendors share one set of columns and
   * match `duckdbTable(record)` and `recordJsonSchema(record)`.
   */
  readonly record?: RecordName | undefined;
  /** Include the vendor's raw payload when `columns` is not given. Defaults to `false`. */
  readonly includeRaw?: boolean | undefined;
}

export interface ExportResult {
  readonly rows: number;
  readonly columns: readonly string[];
}

export interface ExporterExtension {
  /**
   * Writes every record of a listing, for example `outbound.leads.listAll()`,
   * or of an array or any other iterable.
   */
  // The records can be any entity, so the source is typed by what it yields.
  readonly export: <Item>(
    source: AsyncIterable<Item> | Iterable<Item>,
    options: ExportOptions
  ) => Promise<ExportResult>;
}

const isPath = (to: RowWriter | string): to is string => typeof to === "string";

const csvCell = (value: Json | undefined): string => {
  if (value === null || value === undefined) {
    return "";
  }

  const text =
    isJsonObject(value) || Array.isArray(value)
      ? JSON.stringify(value)
      : String(value);

  return /[",\n\r]/u.test(text) ? `"${text.replaceAll('"', '""')}"` : text;
};

const fileWriter = async (
  file: string,
  columns: readonly string[]
): Promise<RowWriter> => {
  const csv = file.endsWith(".csv");

  if (!csv && !file.endsWith(".jsonl")) {
    throw new OutboundError(
      "Invalid",
      "export() writes .csv or .jsonl files; pass a writer for other formats"
    );
  }

  const handle = await open(file, "w");

  // An empty listing with no `columns` given has no header to write.
  if (csv && columns.length > 0) {
    await handle.write(
      `${columns.map((column) => csvCell(column)).join(",")}\n`
    );
  }

  return {
    close: () => handle.close(),
    write: async (row) => {
      const line = csv
        ? columns.map((column) => csvCell(row[column])).join(",")
        : JSON.stringify(row);

      await handle.write(`${line}\n`);
    },
  };
};

const exportRows = async <Item>(
  source: AsyncIterable<Item> | Iterable<Item>,
  options: ExportOptions
): Promise<ExportResult> => {
  let writer: RowWriter | undefined;

  const declared =
    options.columns ??
    (options.record === undefined
      ? undefined
      : recordColumns(options.record, options));

  let columns: readonly string[] = declared ?? [];
  let rows = 0;

  try {
    for await (const item of source) {
      const row = toJson(item);

      if (isJsonObject(row)) {
        if (writer === undefined) {
          columns =
            declared ??
            Object.keys(row).filter(
              (key) => options.includeRaw === true || key !== "raw"
            );
          writer = isPath(options.to)
            ? await fileWriter(options.to, columns)
            : options.to;
        }

        // Every writer gets the same row: the export's columns, in order.
        await writer.write(
          Object.fromEntries(
            columns.map((column) => [column, row[column] ?? null])
          )
        );
        rows += 1;
      }
    }

    // An empty listing still produces a file with its header.
    writer ??= isPath(options.to)
      ? await fileWriter(options.to, columns)
      : options.to;
  } finally {
    // A writer the caller supplied is closed even when no row reached it.
    await (writer ?? (isPath(options.to) ? undefined : options.to))?.close();
  }

  return { columns, rows };
};

/** Adds `outbound.export()`. */
export const exporter = (): OutboundPlugin<ExporterExtension> => ({
  extend: () => ({ export: exportRows }),
  name: "exporter",
});
