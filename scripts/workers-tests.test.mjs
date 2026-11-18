import assert from "node:assert/strict";
import {
  copyFileSync,
  mkdirSync,
  mkdtempSync,
  realpathSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { after, test } from "node:test";

import { planWorkersTests, runOnWorkers } from "./workers-tests.mjs";

const repositoryRoot = path.resolve(import.meta.dirname, "..");
const packageRoot = "packages/outbound-sdk";
const roots = [];

after(() => {
  for (const root of roots) {
    rmSync(root, { force: true, recursive: true });
  }
});

const header =
  'import assert from "node:assert/strict";\nimport { test } from "node:test";\n';

// A miniature of the package: one Workers-safe subpath, one Node folder,
// tests that can and cannot run on Workers, and a fixture.
const miniature = {
  "fixtures/acme/answer.json": '{ "count": 3 }\n',
  [`${packageRoot}/package.json`]: JSON.stringify({
    exports: {
      ".": { import: "./dist/index.js" },
      "./cli": { import: "./dist/cli/index.js" },
    },
  }),
  [`${packageRoot}/src/cli/index.ts`]:
    'import { readFileSync } from "node:fs";\nexport const disk = readFileSync;\n',
  [`${packageRoot}/src/index.ts`]:
    "export const count = (value: number) => value;\n",
  [`${packageRoot}/test/cli.test.ts`]: `${header}import { disk } from "../src/cli/index.ts";\ntest("cli", () => assert.ok(disk));\n`,
  [`${packageRoot}/test/disk.test.ts`]: `${header}import { readFileSync } from "fs";\ntest("disk", () => assert.ok(readFileSync));\n`,
  [`${packageRoot}/test/runtime.test.ts`]: `${header}import { count } from "../src/index.ts";
import { fixture } from "./helpers/fixtures.ts";
test("reads an embedded fixture", () => assert.deepEqual(fixture("acme", "answer.json"), { count: count(3) }));
test("has no Buffer", () => assert.equal(typeof Buffer, "undefined"));
test("has only process.env", () => assert.deepEqual(Object.keys(process), ["env"]));
test("fails", () => assert.equal(count(1), 2));
test("is skipped", { skip: true }, () => assert.fail("ran"));
`,
};

const workspace = () => {
  const root = mkdtempSync(
    path.join(realpathSync(tmpdir()), "outbound-workers-")
  );

  roots.push(root);

  for (const [file, contents] of Object.entries(miniature)) {
    mkdirSync(path.dirname(path.join(root, file)), { recursive: true });
    writeFileSync(path.join(root, file), contents);
  }

  const helper = `${packageRoot}/test/helpers/fixtures.ts`;
  mkdirSync(path.dirname(path.join(root, helper)), { recursive: true });
  copyFileSync(path.join(repositoryRoot, helper), path.join(root, helper));

  return root;
};

test("plans which tests can run on Workers, and why the others cannot", async () => {
  const plan = await planWorkersTests(workspace(), ["internal"]);

  assert.deepEqual(plan.included, [`${packageRoot}/test/runtime.test.ts`]);
  assert.deepEqual(plan.entries, [`${packageRoot}/src/index.ts`]);
  assert.deepEqual(plan.excluded, [
    {
      file: `${packageRoot}/test/cli.test.ts`,
      reason: `reaches ${packageRoot}/src/cli`,
    },
    {
      file: `${packageRoot}/test/disk.test.ts`,
      reason: `${packageRoot}/test/disk.test.ts imports node:fs`,
    },
  ]);
  assert.deepEqual(
    plan.unreached,
    ["internal"],
    "nothing reaches src/internal"
  );
});

test("runs the planned tests in workerd and reports each outcome", async () => {
  const root = workspace();
  const results = await runOnWorkers(root, await planWorkersTests(root, []));

  const outcome = Object.fromEntries(
    results.map((result) => [result.name, result.status])
  );

  assert.deepEqual(outcome, {
    fails: "fail",
    "has no Buffer": "pass",
    "has only process.env": "pass",
    "is skipped": "skip",
    "loads on Workers": "pass",
    "reads an embedded fixture": "pass",
  });
  assert.match(
    results.find((result) => result.name === "fails").error,
    /AssertionError/u
  );
});
