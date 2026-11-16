import assert from "node:assert/strict";
import { test } from "node:test";

import { planFor } from "./check-changed.mjs";

test("a documentation change runs lint and shape only", () => {
  assert.deepEqual(planFor(["docs/architecture.md"]), {
    architecture: false,
    lint: ["docs/architecture.md"],
    limits: true,
    tests: false,
    typecheck: false,
  });
});

test("a source change runs every check", () => {
  const plan = planFor(["packages/outbound-sdk/src/internal/errors.ts"]);
  assert.deepEqual(plan.lint, ["packages/outbound-sdk/src/internal/errors.ts"]);
  assert.ok(plan.typecheck && plan.architecture && plan.tests && plan.limits);
});

test("a fixture change runs the tests but is not linted", () => {
  const plan = planFor(["fixtures/instantly/listCampaigns.json"]);
  assert.deepEqual(plan.lint, []);
  assert.equal(plan.tests, true);
  assert.equal(plan.typecheck, false);
});

test("a site page or skill change runs the tests that hold it to the code", () => {
  for (const file of [
    "site/content/docs/capabilities.mdx",
    "skills/outbound-sdk-setup/SKILL.md",
  ]) {
    const plan = planFor([file]);
    assert.equal(plan.tests, true, file);
    assert.equal(plan.typecheck, false, file);
  }
});

test("deleted files are not passed to the linter", () => {
  const plan = planFor(["scripts/gone.mjs"], () => false);
  assert.deepEqual(plan.lint, []);
  assert.equal(plan.typecheck, true);
});

test("no change runs nothing", () => {
  assert.deepEqual(planFor([]), {
    architecture: false,
    lint: [],
    limits: false,
    tests: false,
    typecheck: false,
  });
});
