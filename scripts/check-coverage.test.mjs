import assert from "node:assert/strict";
import { test } from "node:test";

import { parseLcov, underThreshold } from "./check-coverage.mjs";

const lcov = [
  "TN:",
  "SF:packages/outbound-sdk/src/internal/good.ts",
  "FNF:4",
  "FNH:4",
  "LF:100",
  "LH:99",
  "end_of_record",
  "SF:packages/outbound-sdk/src/internal/thin.ts",
  "FNF:10",
  "FNH:5",
  "LF:200",
  "LH:150",
  "end_of_record",
  "SF:packages/outbound-sdk/src/internal/types.ts",
  "FNF:0",
  "FNH:0",
  "LF:0",
  "LH:0",
  "end_of_record",
  "",
].join("\n");

test("parses one record per file", () => {
  assert.deepEqual(parseLcov(lcov), [
    {
      file: "packages/outbound-sdk/src/internal/good.ts",
      functions: [4, 4],
      lines: [99, 100],
    },
    {
      file: "packages/outbound-sdk/src/internal/thin.ts",
      functions: [5, 10],
      lines: [150, 200],
    },
    {
      file: "packages/outbound-sdk/src/internal/types.ts",
      functions: [0, 0],
      lines: [0, 0],
    },
  ]);
});

test("accepts files at or over the threshold, and files with nothing to run", () => {
  const [good, , types] = parseLcov(lcov);
  assert.deepEqual(
    underThreshold([good, types], { functions: 90, lines: 95 }),
    []
  );
});

test("rejects a file under the line or function threshold", () => {
  const problems = underThreshold(parseLcov(lcov), {
    functions: 90,
    lines: 95,
  });

  assert.deepEqual(problems, [
    "packages/outbound-sdk/src/internal/thin.ts: 75.0% of lines covered, needs 95%",
    "packages/outbound-sdk/src/internal/thin.ts: 50.0% of functions covered, needs 90%",
  ]);
});

test("skips exempt files", () => {
  assert.deepEqual(
    underThreshold(parseLcov(lcov), { functions: 90, lines: 95 }, (file) =>
      file.endsWith("thin.ts")
    ),
    []
  );
});
