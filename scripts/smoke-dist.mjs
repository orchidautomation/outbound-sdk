#!/usr/bin/env node

// Loads every public subpath of the built package. CI runs this on Node 22,
// the oldest runtime consumers are promised, so a syntax or API the build
// target does not cover fails here and not in a consumer's project.

import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";

const packageRoot = path.resolve(
  import.meta.dirname,
  "../packages/outbound-sdk"
);

const manifest = JSON.parse(
  readFileSync(path.join(packageRoot, "package.json"), "utf-8")
);

const load = async ([subpath, entry]) => {
  const file = path.join(packageRoot, entry.import);
  const types = path.join(packageRoot, entry.types);

  if (!existsSync(file) || !existsSync(types)) {
    return `${subpath}: missing ${existsSync(file) ? entry.types : entry.import}`;
  }

  try {
    const loaded = await import(pathToFileURL(file).href);

    return Object.keys(loaded).length === 0
      ? `${subpath}: exports nothing`
      : null;
  } catch (error) {
    return `${subpath}: ${error.message}`;
  }
};

const results = await Promise.all(Object.entries(manifest.exports).map(load));
const failures = results.filter((result) => result !== null);

for (const failure of failures) {
  console.error(`FAIL ${failure}`);
}

console.log(
  `Loaded ${Object.keys(manifest.exports).length - failures.length} of ${Object.keys(manifest.exports).length} subpath(s) on ${process.versions.bun ? `Bun ${process.versions.bun}` : `Node ${process.versions.node}`}`
);

process.exitCode = failures.length > 0 ? 1 : 0;
