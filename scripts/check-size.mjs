#!/usr/bin/env node

// Size budget per public subpath: the gzipped size of the entry file plus
// every chunk it statically imports. Budgets live in size-budget.json.

import { readFileSync } from "node:fs";
import path from "node:path";
import { gzipSync } from "node:zlib";

const repositoryRoot = path.resolve(import.meta.dirname, "..");

const importPattern =
  /(?:import|export)\s*(?:[^"']*?\sfrom\s*)?["'](?<specifier>\.{1,2}\/[^"']+)["']/gu;

const read = (file) => readFileSync(file, "utf-8");

export const closureOf = (entry) => {
  const seen = new Set();
  const queue = [entry];

  while (queue.length > 0) {
    const file = queue.pop();

    if (seen.has(file)) {
      continue;
    }

    seen.add(file);

    for (const match of read(file).matchAll(importPattern)) {
      queue.push(path.join(path.dirname(file), match.groups.specifier));
    }
  }

  return [...seen];
};

export const checkSizes = ({ budgets, exportsMap, packageRoot }) => {
  const rows = [];
  const errors = [];

  for (const [subpath, entry] of Object.entries(exportsMap)) {
    const files = closureOf(path.join(packageRoot, entry.import));

    const bytes = files.reduce(
      (total, file) => total + gzipSync(read(file)).length,
      0
    );

    const limit = budgets[subpath] ?? budgets["*"];
    rows.push({ bytes, limit, subpath });

    if (limit === undefined) {
      errors.push(`${subpath}: no budget in size-budget.json`);
    } else if (bytes > limit) {
      errors.push(
        `${subpath}: ${bytes} bytes gzipped exceeds its ${limit}-byte budget`
      );
    }
  }

  return { errors, rows };
};

if (process.argv[1] && import.meta.filename === path.resolve(process.argv[1])) {
  const packageRoot = path.join(repositoryRoot, "packages/outbound-sdk");

  const manifest = JSON.parse(
    readFileSync(path.join(packageRoot, "package.json"), "utf-8")
  );

  const budgets = JSON.parse(
    readFileSync(path.join(repositoryRoot, "size-budget.json"), "utf-8")
  );

  const result = checkSizes({
    budgets,
    exportsMap: manifest.exports,
    packageRoot,
  });

  for (const row of result.rows) {
    console.log(
      `${row.subpath.padEnd(28)} ${String(row.bytes).padStart(7)} / ${row.limit ?? "?"}`
    );
  }

  for (const error of result.errors) {
    console.error(`FAIL ${error}`);
  }

  process.exitCode = result.errors.length > 0 ? 1 : 0;
}
