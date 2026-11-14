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

const words = (count, salt) =>
  JSON.stringify(
    Array.from({ length: count }, (_, index) => `${salt}-${index * 7919}`)
  );

const fixture = () => {
  const root = mkdtempSync(path.join(tmpdir(), "outbound-size-"));
  roots.push(root);
  mkdirSync(path.join(root, "dist/chunks"), { recursive: true });
  writeFileSync(
    path.join(root, "dist/index.js"),
    'import { used } from "./chunks/shared.js";\nexport const value = used;\nexport const lazy = () => import("./chunks/lazy.js");\n'
  );
  // Only `used` is imported, so `unused` must be tree-shaken away.
  writeFileSync(
    path.join(root, "dist/chunks/shared.js"),
    `export const used = ${words(300, "used")};\nexport const unused = ${words(3000, "unused")};\n`
  );
  writeFileSync(
    path.join(root, "dist/chunks/lazy.js"),
    `export const lazy = ${words(3000, "lazy")};\n`
  );

  return {
    exportsMap: { ".": { import: "./dist/index.js" } },
    packageRoot: root,
  };
};

test("counts the code an entry uses, and leaves out unused exports and dynamic imports", async () => {
  const result = await checkSizes({ ...fixture(), budgets: { ".": 100_000 } });
  assert.deepEqual(result.errors, []);
  const [{ bytes }] = result.rows;
  assert.ok(bytes > 800, `the used chunk is counted (${bytes})`);
  assert.ok(
    bytes < 4000,
    `the unused export and the lazy chunk are not (${bytes})`
  );
});

test("rejects an entry over its budget", async () => {
  const result = await checkSizes({ ...fixture(), budgets: { ".": 200 } });
  assert.match(result.errors[0], /exceeds its 200-byte budget/u);
});

test("falls back to the default budget, and rejects a subpath with none", async () => {
  assert.deepEqual(
    (await checkSizes({ ...fixture(), budgets: { "*": 100_000 } })).errors,
    []
  );
  const result = await checkSizes({ ...fixture(), budgets: {} });
  assert.match(result.errors[0], /no budget/u);
});
