#!/usr/bin/env node

// A coverage gate per file. Runs the package's tests with Node's built-in
// coverage and fails when any source file is under the line or function
// threshold. A whole-suite average would let one untested file hide.

import { spawnSync } from "node:child_process";
import path from "node:path";

export const thresholds = { functions: 90, lines: 95 };

// Entry files only re-export; type-only files have nothing to execute.
const exempt = [
  /\/index\.ts$/u,
  /\/api\.ts$/u,
  /\/adapter\.ts$/u,
  /\/limits\.ts$/u,
];

export const parseLcov = (lcov) => {
  const files = [];
  let current = null;

  for (const line of lcov.split("\n")) {
    const [tag, value] = [
      line.slice(0, line.indexOf(":")),
      line.slice(line.indexOf(":") + 1),
    ];

    if (tag === "SF") {
      current = { file: value, functions: [0, 0], lines: [0, 0] };
    } else if (current && tag === "LF") {
      current.lines[1] = Number(value);
    } else if (current && tag === "LH") {
      current.lines[0] = Number(value);
    } else if (current && tag === "FNF") {
      current.functions[1] = Number(value);
    } else if (current && tag === "FNH") {
      current.functions[0] = Number(value);
    } else if (current && line === "end_of_record") {
      files.push(current);
      current = null;
    }
  }

  return files;
};

const percent = ([hit, found]) => (found === 0 ? 100 : (hit / found) * 100);

export const underThreshold = (
  files,
  limits = thresholds,
  isExempt = () => false
) =>
  files
    .filter((entry) => !isExempt(entry.file))
    .flatMap((entry) => {
      const lines = percent(entry.lines);
      const functions = percent(entry.functions);
      const problems = [];

      if (lines < limits.lines) {
        problems.push(
          `${entry.file}: ${lines.toFixed(1)}% of lines covered, needs ${limits.lines}%`
        );
      }

      if (functions < limits.functions) {
        problems.push(
          `${entry.file}: ${functions.toFixed(1)}% of functions covered, needs ${limits.functions}%`
        );
      }

      return problems;
    });

if (process.argv[1] && import.meta.filename === path.resolve(process.argv[1])) {
  const result = spawnSync(
    process.execPath,
    [
      "--test",
      "--experimental-test-coverage",
      "--test-coverage-include=packages/outbound-sdk/src/**",
      "--test-reporter=lcov",
      "packages/*/test/**/*.test.ts",
    ],
    { encoding: "utf-8", maxBuffer: 256 * 1024 * 1024 }
  );

  const files = parseLcov(result.stdout);

  const problems = underThreshold(files, thresholds, (file) =>
    exempt.some((pattern) => pattern.test(file))
  );

  for (const problem of problems) {
    console.error(`FAIL ${problem}`);
  }

  if (result.status !== 0) {
    console.error("FAIL the test run itself failed; run npm test for details");
  }

  console.log(
    `Coverage: ${problems.length} file(s) under threshold of ${files.length} measured`
  );
  process.exitCode =
    problems.length > 0 || result.status !== 0 || files.length === 0 ? 1 : 0;
}
