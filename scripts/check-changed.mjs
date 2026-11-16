#!/usr/bin/env node

// Runs only the checks a change touches. Use it while editing; `npm run check`
// is the full gate before a push.

import { execFileSync, spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import path from "node:path";

const lintable = /\.(?:[cm]?[jt]s|json|jsonc|md|ya?ml)$/u;
const code = /\.(?:[cm]?[jt]s)$/u;
const documentation = /^(?:docs\/|README\.md$|LICENSE$|\.changeset\/)/u;

// Pages and skills the tests hold to the code: a change to one runs the tests.
const checkedProse = /^(?:site\/content\/|skills\/)/u;

const git = (root, args) =>
  execFileSync("git", args, { cwd: root, encoding: "utf-8" })
    .split("\n")
    .filter(Boolean);

export const changedFiles = (root, base = "origin/main") => {
  const [mergeBase] = git(root, ["merge-base", base, "HEAD"]);

  return [
    ...new Set([
      ...git(root, ["diff", "--name-only", mergeBase]),
      ...git(root, ["ls-files", "--others", "--exclude-standard"]),
    ]),
  ];
};

// What to run for a set of changed files.
export const planFor = (changed, exists = () => true) => {
  const present = changed.filter((file) => exists(file));

  const lint = present.filter(
    (file) => lintable.test(file) && !file.startsWith("fixtures/")
  );

  const touchesCode = changed.some(
    (file) => code.test(file) || file.endsWith("package.json")
  );

  const touchesFixtures = changed.some((file) => file.startsWith("fixtures/"));
  const touchesProse = changed.some((file) => checkedProse.test(file));
  const docsOnly = changed.every((file) => documentation.test(file));

  return {
    architecture: touchesCode,
    lint,
    limits: changed.length > 0,
    tests: !docsOnly && (touchesCode || touchesFixtures || touchesProse),
    typecheck: touchesCode,
  };
};

const run = (root, command, args) =>
  spawnSync(command, args, { cwd: root, shell: false, stdio: "inherit" })
    .status === 0;

if (process.argv[1] && import.meta.filename === path.resolve(process.argv[1])) {
  const root = process.cwd();

  const plan = planFor(changedFiles(root), (file) =>
    existsSync(path.join(root, file))
  );

  const steps = [
    [plan.lint.length > 0, "npx", ["ultracite", "check", ...plan.lint]],
    [plan.typecheck, "npm", ["run", "--silent", "typecheck"]],
    [plan.architecture, "npm", ["run", "--silent", "architecture"]],
    [plan.limits, "npm", ["run", "--silent", "shape"]],
    [plan.tests, "npm", ["test", "--silent"]],
  ];

  const failed = steps.filter(
    ([enabled, command, args]) => enabled && !run(root, command, args)
  );

  console.log(
    `check:changed ran ${steps.filter(([enabled]) => enabled).length} step(s)`
  );
  process.exitCode = failed.length > 0 ? 1 : 0;
}
