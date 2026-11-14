#!/usr/bin/env node

import path from "node:path";

import { cruise } from "dependency-cruiser";

import {
  architectureRules,
  filesUnder,
  sourceRoot,
  testRoot,
} from "./architecture-rules.mjs";

export const checkArchitecture = async (root) => {
  const files = [sourceRoot, testRoot]
    .flatMap((directory) => filesUnder(root, directory))
    .filter((file) => /\.(?:[cm]?[jt]s)$/u.test(file));

  if (files.length === 0) {
    return { error: 0, totalCruised: 0, violations: [] };
  }

  const result = await cruise(
    files,
    {
      baseDir: root,
      detectProcessBuiltinModuleCalls: true,
      // Keep external edges visible to the rules without parsing them.
      doNotFollow: { path: "(?:^|/)(?:node_modules|dist)/" },
      outputType: "json",
      ruleSet: architectureRules(root),
      tsPreCompilationDeps: true,
      validate: true,
    },
    {
      bustTheCache: true,
      conditionNames: ["types", "import", "node", "default"],
      exportsFields: ["exports"],
      extensions: [".ts", ".mts", ".js", ".mjs", ".json"],
    }
  );

  return JSON.parse(result.output).summary;
};

if (process.argv[1] && import.meta.filename === path.resolve(process.argv[1])) {
  const summary = await checkArchitecture(process.cwd());

  for (const violation of summary.violations) {
    console.error(
      `${violation.rule.name}: ${violation.from} -> ${violation.to}`
    );
  }

  console.log(
    `Architecture: ${summary.error} errors; ${summary.totalCruised} modules checked`
  );
  process.exitCode = summary.error ? 1 : 0;
}
