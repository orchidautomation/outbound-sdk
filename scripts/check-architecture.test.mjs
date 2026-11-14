import assert from "node:assert/strict";
import {
  cpSync,
  mkdirSync,
  mkdtempSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { after, test } from "node:test";

import { checkArchitecture } from "./check-architecture.mjs";

const repositoryRoot = path.resolve(import.meta.dirname, "..");
const roots = [];

after(() => {
  for (const root of roots) {
    rmSync(root, { force: true, recursive: true });
  }
});

// A healthy miniature of the package. Each test adds one import to it.
const healthy = {
  "src/index.ts": 'export { engine } from "./internal/index.ts";\n',
  "src/instantly/index.ts":
    'import { engine } from "../internal/index.ts";\nexport const instantly = engine;\n',
  "src/internal/index.ts":
    'import { z } from "zod";\nexport const engine = z.string();\n',
  "src/smartlead/index.ts":
    'import { engine } from "../internal/index.ts";\nexport const smartlead = engine;\n',
  "src/webhooks/index.ts":
    'import { instantly } from "../instantly/index.ts";\nexport const parse = instantly;\n',
  "test/core.test.ts":
    'import { engine } from "../src/index.ts";\nexport const subject = engine;\n',
};

const violationsFor = async (files = {}) => {
  const root = mkdtempSync(path.join(tmpdir(), "outbound-architecture-"));
  roots.push(root);

  for (const [file, contents] of Object.entries({ ...healthy, ...files })) {
    const destination = path.join(root, "packages/outbound-sdk", file);
    mkdirSync(path.dirname(destination), { recursive: true });
    writeFileSync(destination, contents);
  }

  cpSync(
    path.join(repositoryRoot, "tsconfig.json"),
    path.join(root, "tsconfig.json")
  );
  symlinkSync(
    path.join(repositoryRoot, "node_modules"),
    path.join(root, "node_modules")
  );

  const summary = await checkArchitecture(root);

  return summary.violations.map((violation) => violation.rule.name);
};

test("accepts the allowed import directions", async () => {
  assert.deepEqual(await violationsFor(), []);
});

test("rejects an adapter importing another adapter", async () => {
  const names = await violationsFor({
    "src/smartlead/index.ts":
      'import { instantly } from "../instantly/index.ts";\nexport const smartlead = instantly;\n',
  });

  assert.deepEqual(names, ["smartlead-dependency-direction"]);
});

test("rejects internal importing an adapter", async () => {
  const names = await violationsFor({
    "src/internal/extra.ts":
      'import { instantly } from "../instantly/index.ts";\nexport const extra = instantly;\n',
  });

  assert.ok(names.includes("internal-dependency-direction"), names.join(","));
});

test("rejects an import cycle", async () => {
  const names = await violationsFor({
    "src/internal/a.ts": 'import { b } from "./b.ts";\nexport const a = b;\n',
    "src/internal/b.ts": 'import { a } from "./a.ts";\nexport const b = a;\n',
  });

  assert.ok(names.includes("no-cycles"), names.join(","));
});

test("rejects an undeclared source folder", async () => {
  const names = await violationsFor({
    "src/mystery/index.ts": "export const mystery = 1;\n",
  });

  assert.ok(names.includes("undeclared-source-folder-orphan"), names.join(","));

  const importing = await violationsFor({
    "src/mystery/index.ts":
      'import { engine } from "../internal/index.ts";\nexport const mystery = engine;\n',
  });

  assert.ok(
    importing.includes("undeclared-source-folder"),
    importing.join(",")
  );
});

test("rejects Node built-ins outside the folders that may use them", async () => {
  const names = await violationsFor({
    "src/instantly/disk.ts":
      'import { readFileSync } from "node:fs";\nexport const disk = readFileSync;\n',
  });

  assert.ok(names.includes("web-standards-only"), names.join(","));
  assert.deepEqual(
    await violationsFor({
      "src/cli/index.ts":
        'import { readFileSync } from "node:fs";\nexport const disk = readFileSync;\n',
    }),
    []
  );
});

test("rejects an external package that is not allowed for the folder", async () => {
  const names = await violationsFor({
    "src/instantly/extra.ts":
      'import { build } from "esbuild";\nexport const extra = build;\n',
  });

  assert.ok(names.includes("instantly-external-packages"), names.join(","));
});

test("rejects a test that reaches past an entry point", async () => {
  const names = await violationsFor({
    "src/internal/deep.ts": "export const deep = 1;\n",
    "test/deep.test.ts":
      'import { deep } from "../src/internal/deep.ts";\nexport const subject = deep;\n',
  });

  assert.deepEqual(names, ["tests-use-entry-points"]);
});

test("rejects production code importing a test", async () => {
  const names = await violationsFor({
    "src/internal/leak.ts":
      'import { subject } from "../../test/core.test.ts";\nexport const leak = subject;\n',
  });

  assert.ok(names.includes("no-production-test-imports"), names.join(","));
});
