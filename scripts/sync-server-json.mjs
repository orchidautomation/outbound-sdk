#!/usr/bin/env node

// Copies the package version into packages/outbound-sdk/server.json, the
// MCP Registry entry, after `changeset version` bumps package.json. The
// registry refuses an entry whose version npm has not published, so the two
// must move together; packages/outbound-sdk/test/mcp-registry.test.ts fails
// when they differ.
//
//   node scripts/sync-server-json.mjs [package dir]

import { readFileSync, writeFileSync } from "node:fs";
import path from "node:path";

/** The server.json text with both versions set to `version`. */
export const withVersion = (text, version) => {
  const server = JSON.parse(text);

  server.version = version;

  for (const entry of server.packages ?? []) {
    entry.version = version;
  }

  return `${JSON.stringify(server, null, 2)}\n`;
};

export const syncServerJson = (packageDir) => {
  const { version } = JSON.parse(
    readFileSync(path.join(packageDir, "package.json"), "utf-8")
  );

  const file = path.join(packageDir, "server.json");
  const before = readFileSync(file, "utf-8");
  const after = withVersion(before, version);

  if (after !== before) {
    writeFileSync(file, after);
  }

  return version;
};

if (process.argv[1] && import.meta.filename === path.resolve(process.argv[1])) {
  const [
    packageDir = path.join(
      import.meta.dirname,
      "..",
      "packages",
      "outbound-sdk"
    ),
  ] = process.argv.slice(2);

  console.log(`server.json at ${syncServerJson(path.resolve(packageDir))}`);
}
