#!/usr/bin/env node

// Builds packages/outbound-sdk into dist/: one ESM file per public subpath
// with shared code in chunks (esbuild), and matching .d.ts files (tsc).
// Entry points come from the package's exports map, so the map is the only
// list of public subpaths.

import { execFileSync } from "node:child_process";
import { readFileSync, rmSync } from "node:fs";
import path from "node:path";

import { build } from "esbuild";

const repositoryRoot = path.resolve(import.meta.dirname, "..");

export const packageRoot = path.join(repositoryRoot, "packages/outbound-sdk");

export const readManifest = () =>
  JSON.parse(readFileSync(path.join(packageRoot, "package.json"), "utf-8"));

// "./dist/instantly/index.js" -> "src/instantly/index.ts"
export const sourceFor = (target) =>
  target.replace(/^\.\/dist\//u, "src/").replace(/\.js$/u, ".ts");

// Every public subpath, plus each executable in `bin`.
export const entryPoints = (manifest) => [
  ...Object.values(manifest.exports).map((entry) => sourceFor(entry.import)),
  ...Object.values(manifest.bin ?? {}).map((target) => sourceFor(target)),
];

export const buildPackage = async () => {
  const manifest = readManifest();
  const dist = path.join(packageRoot, "dist");
  rmSync(dist, { force: true, recursive: true });

  await build({
    absWorkingDir: packageRoot,
    banner: {},
    bundle: true,
    chunkNames: "chunks/[name]-[hash]",
    entryPoints: entryPoints(manifest),
    external: [
      ...Object.keys(manifest.dependencies ?? {}),
      ...Object.keys(manifest.peerDependencies ?? {}),
      "node:*",
    ],
    format: "esm",
    legalComments: "none",
    logLevel: "warning",
    outbase: "src",
    outdir: dist,
    platform: "neutral",
    splitting: true,
    target: "es2022",
  });

  execFileSync(
    process.execPath,
    [
      path.join(repositoryRoot, "node_modules/typescript/bin/tsc"),
      "-p",
      "tsconfig.build.json",
    ],
    { cwd: packageRoot, stdio: "inherit" }
  );

  return { dist, entries: entryPoints(manifest).length };
};

if (process.argv[1] && import.meta.filename === path.resolve(process.argv[1])) {
  const result = await buildPackage();
  console.log(
    `Built ${result.entries} entry point(s) into ${path.relative(repositoryRoot, result.dist)}`
  );
}
