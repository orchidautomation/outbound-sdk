import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import {
  mkdtempSync,
  readFileSync,
  realpathSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { after, test } from "node:test";

import { versionText, writeVersion } from "./site-version.mjs";

const roots = [];

after(() => {
  for (const root of roots) {
    rmSync(root, { force: true, recursive: true });
  }
});

const repo = () => {
  const root = mkdtempSync(path.join(realpathSync(tmpdir()), "site-version-"));
  roots.push(root);

  const git = (...args) =>
    execFileSync("git", args, { cwd: root, encoding: "utf-8" }).trim();

  git("init", "-q");
  writeFileSync(path.join(root, "a.txt"), "a");
  git("add", "a.txt");
  git(
    "-c",
    "user.name=test",
    "-c",
    "user.email=test@example.com",
    "-c",
    "commit.gpgsign=false",
    "commit",
    "-qm",
    "a"
  );

  return { commit: git("rev-parse", "HEAD"), root };
};

test("names the commit, whether the checkout was clean, and when", () => {
  assert.equal(
    versionText({
      builtAt: "2026-11-18T12:00:00.000Z",
      commit: "abc123",
      dirty: false,
    }),
    "commit abc123\ndirty false\nbuilt 2026-11-18T12:00:00.000Z\n"
  );
});

test("writes version.txt for a clean checkout", () => {
  const { commit, root } = repo();
  const publicDir = path.join(root, "public");
  // The written file itself would make the checkout dirty.
  writeFileSync(path.join(root, ".gitignore"), "public/\n.gitignore\n");

  const file = writeVersion(publicDir, new Date("2026-11-18T12:00:00Z"));

  assert.equal(
    readFileSync(file, "utf-8"),
    `commit ${commit}\ndirty false\nbuilt 2026-11-18T12:00:00.000Z\n`
  );
});

test("says dirty when the checkout has uncommitted changes", () => {
  const { root } = repo();
  writeFileSync(path.join(root, "a.txt"), "changed");

  const file = writeVersion(path.join(root, "public"));

  assert.match(readFileSync(file, "utf-8"), /^dirty true$/mu);
});
