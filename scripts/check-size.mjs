#!/usr/bin/env node

// Size budget per public subpath: what a consumer's bundler ships for that
// import. Each built entry is bundled on its own with tree-shaking and
// minification, then gzipped. Code behind a dynamic import() is left out,
// because a bundler loads it only when it is used. dist/ itself stays
// unminified so it is readable in a debugger. Budgets live in
// size-budget.json; "*" is the default for a subpath with no entry.

import { readFileSync } from "node:fs";
import path from "node:path";
import { gzipSync } from "node:zlib";

import { build } from "esbuild";

const repositoryRoot = path.resolve(import.meta.dirname, "..");

const importPattern =
  /(?:import|export)\s*(?:[^"']*?\sfrom\s*)?["'](?<specifier>\.{1,2}\/[^"']+)["']/gu;

// The entry's output plus every chunk it statically imports.
export const staticClosure = (entry, outputs) => {
  const seen = new Set();
  const queue = [entry];

  while (queue.length > 0) {
    const file = queue.pop();

    if (!seen.has(file) && outputs.has(file)) {
      seen.add(file);

      for (const match of outputs.get(file).matchAll(importPattern)) {
        queue.push(path.join(path.dirname(file), match.groups.specifier));
      }
    }
  }

  return [...seen];
};

export const shippedBytes = async (entryFile, external) => {
  const outdir = path.join(path.dirname(entryFile), ".size");

  const result = await build({
    bundle: true,
    entryPoints: { entry: entryFile },
    external,
    format: "esm",
    logLevel: "silent",
    minify: true,
    outdir,
    platform: "neutral",
    splitting: true,
    write: false,
  });

  const outputs = new Map(
    result.outputFiles.map((file) => [file.path, file.text])
  );

  return staticClosure(path.join(outdir, "entry.js"), outputs).reduce(
    (total, file) => total + gzipSync(outputs.get(file)).length,
    0
  );
};

export const checkSizes = async ({
  budgets,
  exportsMap,
  external = [],
  packageRoot,
}) => {
  const rows = await Promise.all(
    Object.entries(exportsMap).map(async ([subpath, entry]) => ({
      bytes: await shippedBytes(path.join(packageRoot, entry.import), external),
      limit: budgets[subpath] ?? budgets["*"],
      subpath,
    }))
  );

  const errors = rows.flatMap((row) => {
    if (row.limit === undefined) {
      return [`${row.subpath}: no budget in size-budget.json`];
    }

    return row.bytes > row.limit
      ? [
          `${row.subpath}: ${row.bytes} bytes minified and gzipped exceeds its ${row.limit}-byte budget`,
        ]
      : [];
  });

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

  const result = await checkSizes({
    budgets,
    exportsMap: manifest.exports,
    external: [
      ...Object.keys(manifest.dependencies ?? {}),
      ...Object.keys(manifest.peerDependencies ?? {}),
      "node:*",
    ],
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
