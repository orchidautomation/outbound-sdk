#!/usr/bin/env node

// Writes site/public/version.txt before a site build, so the deployed site
// says which commit it was built from: `curl https://outbound-sdk.dev/version.txt`.
// A build from a checkout with uncommitted changes says so.
//
//   node scripts/site-version.mjs [public dir]

import { execFileSync } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";

export const versionText = ({ builtAt, commit, dirty }) =>
  [`commit ${commit}`, `dirty ${dirty}`, `built ${builtAt}`, ""].join("\n");

const git = (cwd, args) =>
  execFileSync("git", args, { cwd, encoding: "utf-8" }).trim();

export const writeVersion = (publicDir, now = new Date()) => {
  mkdirSync(publicDir, { recursive: true });

  const commit = git(publicDir, ["rev-parse", "HEAD"]);
  const dirty = git(publicDir, ["status", "--porcelain"]) !== "";
  const file = path.join(publicDir, "version.txt");

  writeFileSync(
    file,
    versionText({ builtAt: now.toISOString(), commit, dirty })
  );

  return file;
};

if (process.argv[1] && import.meta.filename === path.resolve(process.argv[1])) {
  const [publicDir = path.join(import.meta.dirname, "..", "site", "public")] =
    process.argv.slice(2);

  console.log(`Wrote ${writeVersion(path.resolve(publicDir))}`);
}
