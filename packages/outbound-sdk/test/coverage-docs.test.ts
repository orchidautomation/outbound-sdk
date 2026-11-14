// Checks docs/coverage/<vendor>.md against the adapter: every endpoint a
// vendor documents is normalized, in the native catalog, excluded with a
// reason, or a write.

import assert from "node:assert/strict";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { test } from "node:test";

import { heyreach } from "../src/heyreach/index.ts";
import { CAPABILITY_KEYS } from "../src/index.ts";
import type { Adapter, NativeCatalog } from "../src/index.ts";
import { instantly } from "../src/instantly/index.ts";
import { smartlead } from "../src/smartlead/index.ts";

const FOLDER = path.resolve(import.meta.dirname, "../../../docs/coverage");

const ADAPTERS: Readonly<Record<string, () => Adapter<NativeCatalog>>> = {
  heyreach: () => heyreach({ apiKey: "test-key" }),
  instantly: () => instantly({ apiKey: "test-key" }),
  smartlead: () => smartlead({ apiKey: "test-key" }),
};

/** Vendors that must have a coverage file. */
const REQUIRED: readonly string[] = ["heyreach", "instantly", "smartlead"];

const METHODS = new Set(["DELETE", "GET", "PATCH", "POST", "PUT"]);

const NORMALIZED = new Set<string>([
  ...CAPABILITY_KEYS,
  "campaigns.get",
  "campaigns.list",
]);

interface Row {
  readonly method: string;
  readonly path: string;
  readonly reads: string;
  readonly coverage: string;
  readonly through: string;
}

const unquote = (cell: string): string =>
  cell
    .trim()
    .replaceAll("`", "")
    .replaceAll(String.raw`\|`, "|");

const parse = (file: string): Row[] => {
  const lines = readFileSync(file, "utf-8").split("\n");
  const header = lines.findIndex((line) => /^\|\s*Method\s*\|/u.test(line));
  assert.notEqual(header, -1, `${file} has a table starting with Method`);
  const rows: Row[] = [];

  for (const line of lines.slice(header + 2)) {
    if (!line.startsWith("|")) {
      break;
    }

    const cells = line
      .split(/(?<!\\)\|/u)
      .slice(1, -1)
      .map(unquote);

    assert.equal(cells.length, 5, `five columns in: ${line}`);

    const [method = "", route = "", reads = "", coverage = "", through = ""] =
      cells;

    rows.push({ coverage, method, path: route, reads, through });
  }

  return rows;
};

const vendors = existsSync(FOLDER)
  ? readdirSync(FOLDER)
      .filter((name) => name.endsWith(".md") && name !== "README.md")
      .map((name) => name.replace(/\.md$/u, ""))
  : [];

test("every vendor that must have a coverage file has one", () => {
  for (const vendor of REQUIRED) {
    assert.ok(vendors.includes(vendor), `docs/coverage/${vendor}.md exists`);
  }
});

const checkNormalized = (row: Row): void => {
  const reads = row.through.split(",").map((read) => read.trim());
  assert.ok(reads[0] !== "", `${row.method} ${row.path} names an SDK read`);

  for (const read of reads) {
    assert.ok(
      NORMALIZED.has(read),
      `${row.method} ${row.path}: "${read}" is not an SDK read`
    );
  }
};

const checkNative = (row: Row, catalog: NativeCatalog): void => {
  const read = catalog[row.through];

  assert.ok(
    read,
    `${row.method} ${row.path}: "${row.through}" is not in the native catalog`
  );
  assert.equal(read.method, row.method, `${row.through} method`);
  assert.equal(read.path, row.path, `${row.through} path`);
};

for (const vendor of vendors) {
  test(`${vendor}: every documented endpoint is normalized, native, excluded with a reason, or a write`, () => {
    const make = ADAPTERS[vendor];
    assert.ok(make, `${vendor} is a known adapter`);
    const adapter = make();
    const catalog: NativeCatalog = adapter.native ?? {};
    const rows = parse(path.join(FOLDER, `${vendor}.md`));
    assert.ok(rows.length >= 20, "the inventory lists the vendor's endpoints");
    const seen = new Set<string>();

    for (const row of rows) {
      const key = `${row.method} ${row.path}`;
      assert.ok(METHODS.has(row.method), `${key}: a known method`);
      assert.ok(row.path.startsWith("/"), `${key}: a path`);
      assert.ok(!seen.has(key), `${key} is listed once`);
      seen.add(key);
      assert.ok(row.reads.length > 3, `${key} says what it reads or does`);

      if (row.coverage === "normalized") {
        checkNormalized(row);
      } else if (row.coverage === "native") {
        checkNative(row, catalog);
      } else if (row.coverage === "excluded") {
        assert.ok(row.through.length > 15, `${key} gives its reason`);
      } else {
        assert.equal(row.coverage, "write", `${key}: a known coverage value`);
        assert.notEqual(row.method, "GET", `${key}: a GET is not a write`);
      }
    }

    const listed = new Set(
      rows.flatMap((row) => (row.coverage === "native" ? [row.through] : []))
    );

    for (const name of Object.keys(catalog)) {
      assert.ok(listed.has(name), `native read ${name} is in the inventory`);
    }

    assert.equal(
      adapter.capabilities?.native ?? false,
      Object.keys(catalog).length > 0,
      "native is declared exactly when the catalog has reads"
    );
  });
}
