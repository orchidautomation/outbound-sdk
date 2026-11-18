// The columns, JSON Schema and DuckDB table of one exported record, all
// generated from the record's Zod schema, so a warehouse table has the same
// columns and types whichever vendor filled the rows, and an all-null column
// keeps its type instead of being inferred as NULL.

import { z } from "zod";

import { OutboundError } from "../internal/errors.ts";
import { RECORD_SCHEMAS } from "../internal/fields.ts";
import type { RecordName } from "../internal/fields.ts";

export type { RecordName } from "../internal/fields.ts";

export interface RecordSchemaOptions {
  /** Include the vendor's raw payload as a column. Defaults to `false`, as `export()` does. */
  readonly includeRaw?: boolean | undefined;
}

export interface DuckdbTableOptions extends RecordSchemaOptions {
  /** The table to create. Defaults to the record's name, such as `reply`. */
  readonly table?: string | undefined;
}

/** The parts of a JSON Schema node that decide a column's type. */
export interface ColumnSchema {
  readonly type?: string | readonly string[];
  readonly format?: string;
  readonly anyOf?: readonly ColumnSchema[];
  readonly $ref?: string;
}

/** The JSON Schema of one exported row. */
export interface RowJsonSchema {
  readonly $schema: string;
  readonly type: "object";
  readonly properties: Readonly<Record<string, ColumnSchema>>;
  readonly required: readonly string[];
  readonly additionalProperties: false;
}

const recordFields = (record: RecordName): Record<string, z.ZodType> => {
  const schema = RECORD_SCHEMAS[record];

  if (schema === undefined) {
    throw new OutboundError(
      "Invalid",
      `${String(record)} is not a record; pass one of ${Object.keys(RECORD_SCHEMAS).join(", ")}`
    );
  }

  return schema.shape;
};

/**
 * The columns an export of the record writes, in the schema's order: every
 * field, `raw` only with `includeRaw`.
 */
export const recordColumns = (
  record: RecordName,
  options: RecordSchemaOptions = {}
): string[] =>
  Object.keys(recordFields(record)).filter(
    (column) => options.includeRaw === true || column !== "raw"
  );

// A field a vendor may leave out is written as null, so it accepts null.
const columnOf = (field: z.ZodType): z.ZodType => {
  if (!(field instanceof z.ZodOptional)) {
    return field;
  }

  // SAFETY: an optional field wraps a Zod type, which unwrap returns.
  const inner = field.unwrap() as z.ZodType;

  return inner.safeParse(null).success ? inner : inner.nullable();
};

/**
 * The JSON Schema (draft 2020-12) of one exported row of the record. Every
 * column is required, and a field the record may leave out is nullable,
 * because an export with `record` writes it as `null`.
 */
export const recordJsonSchema = (
  record: RecordName,
  options: RecordSchemaOptions = {}
): RowJsonSchema => {
  const fields = recordFields(record);

  const row = z
    .object(
      Object.fromEntries(
        recordColumns(record, options).map((column) => [
          column,
          columnOf(fields[column] ?? z.unknown()),
        ])
      )
    )
    .strict();

  const json = z.toJSONSchema(row, { io: "output", unrepresentable: "any" });

  return {
    $schema: json.$schema ?? "https://json-schema.org/draft/2020-12/schema",
    additionalProperties: false,
    // SAFETY: every property of an object's JSON Schema is a schema node, never a bare boolean, since each column has a Zod type.
    properties: (json.properties ?? {}) as Record<string, ColumnSchema>,
    required: json.required ?? [],
    type: "object",
  };
};

/** A column's types other than null, and whether null is one of them. */
interface ColumnTypes {
  readonly nullable: boolean;
  readonly types: readonly ColumnSchema[];
}

const isNull = (schema: ColumnSchema): boolean => schema.type === "null";

const typesOf = (schema: ColumnSchema): ColumnTypes => {
  if (schema.anyOf !== undefined) {
    return {
      nullable: schema.anyOf.some(isNull),
      types: schema.anyOf.filter((each) => !isNull(each)),
    };
  }

  if (Array.isArray(schema.type)) {
    const types: readonly string[] = schema.type;

    return {
      nullable: types.includes("null"),
      types: types.flatMap((type) =>
        type === "null" ? [] : [{ ...schema, type }]
      ),
    };
  }

  return { nullable: false, types: [schema] };
};

const duckdbType = (types: readonly ColumnSchema[]): string => {
  const [only] = types;

  if (types.length !== 1 || only === undefined) {
    return "JSON";
  }

  switch (only.type) {
    case "boolean": {
      return "BOOLEAN";
    }

    case "integer": {
      return "BIGINT";
    }

    case "number": {
      return "DOUBLE";
    }

    case "string": {
      if (only.format === "date-time") {
        return "TIMESTAMPTZ";
      }

      return only.format === "date" ? "DATE" : "VARCHAR";
    }

    default: {
      return "JSON";
    }
  }
};

const quoted = (name: string): string => `"${name.replaceAll('"', '""')}"`;

/**
 * A DuckDB `CREATE TABLE IF NOT EXISTS` for the record's exported rows, one
 * column per field with the field's name. Load a `.jsonl` export of the
 * same record into it with `COPY <table> FROM '<file>.jsonl'`. A column the
 * record always fills is `NOT NULL`; nested values are `JSON`.
 */
export const duckdbTable = (
  record: RecordName,
  options: DuckdbTableOptions = {}
): string => {
  const columns = Object.entries(
    recordJsonSchema(record, options).properties
  ).map(([column, property]) => {
    const { nullable, types } = typesOf(property);

    return `  ${quoted(column)} ${duckdbType(types)}${nullable ? "" : " NOT NULL"}`;
  });

  return `CREATE TABLE IF NOT EXISTS ${quoted(options.table ?? record)} (\n${columns.join(",\n")}\n);`;
};
