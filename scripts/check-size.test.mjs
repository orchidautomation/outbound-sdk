import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { after, test } from "node:test";

import { checkSizes } from "./check-size.mjs";

const roots = [];

after(() => {
  for (const root of roots) {
    rmSync(root, { force: true, recursive: true });
  }
});

const fixture = () => {
  const root = mkdtempSync(path.join(tmpdir(), "outbound-size-"));
  roots.push(root);
  mkdirSync(path.join(root, "dist/chunks"), { recursive: true });
  writeFileSync(
    path.join(root, "dist/index.js"),
    'import { a } from "./chunks/a.js";\nexport { a };\n'
  );
  writeFileSync(
    path.join(root, "dist/chunks/a.js"),
    `export const a = ${JSON.stringify(Array.from({ length: 400 }, (_, index) => `value-${index * 7919}`))};\n`
  );

  return {
    exportsMap: { ".": { import: "./dist/index.js" } },
    packageRoot: root,
  };
};

test("accepts an entry within its budget and counts imported chunks", () => {
  const result = checkSizes({ ...fixture(), budgets: { ".": 100_000 } });
  assert.deepEqual(result.errors, []);
  assert.ok(result.rows[0].bytes > 500, "the chunk's bytes are included");
});

test("rejects an entry over its budget", () => {
  const result = checkSizes({ ...fixture(), budgets: { ".": 200 } });
  assert.match(result.errors[0], /exceeds its 200-byte budget/u);
});

test("rejects a subpath with no budget", () => {
  const result = checkSizes({ ...fixture(), budgets: {} });
  assert.match(result.errors[0], /no budget/u);
});
