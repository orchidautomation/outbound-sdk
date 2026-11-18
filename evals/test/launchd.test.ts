// The launchd install and uninstall scripts, run against a scratch
// LaunchAgents folder and a launchctl stand-in that records its arguments.

import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import {
  chmodSync,
  copyFileSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { test } from "node:test";

const LAUNCHD = path.join(import.meta.dirname, "../launchd");
const PLIST = "dev.outbound-sdk.evals.plist";

const scratch = (branch: string) => {
  const root = mkdtempSync(path.join(tmpdir(), "evals-launchd-"));
  const repo = path.join(root, "checkout");
  mkdirSync(path.join(repo, "evals/launchd"), { recursive: true });
  copyFileSync(
    path.join(LAUNCHD, PLIST),
    path.join(repo, "evals/launchd", PLIST)
  );
  spawnSync("git", ["init", "-q", "-b", branch, repo]);

  const calls = path.join(root, "launchctl.log");
  const launchctl = path.join(root, "launchctl");
  writeFileSync(
    launchctl,
    [
      "#!/bin/sh",
      `echo "$*" >> "${calls}"`,
      'if [ "$1" = bootout ] && [ -n "$FAIL_BOOTOUT" ]; then exit 5; fi',
      'if [ "$1" = print ] && [ -z "$STILL_LOADED" ]; then exit 113; fi',
      "exit 0",
      "",
    ].join("\n")
  );
  chmodSync(launchctl, 0o755);

  const env = {
    ...process.env,
    EVALS_REPO: repo,
    LAUNCHCTL: launchctl,
    LAUNCH_AGENTS_DIR: path.join(root, "LaunchAgents"),
  };

  return {
    calls: () => (existsSync(calls) ? readFileSync(calls, "utf-8") : ""),
    env,
    repo,
    root,
    run: (script: string, args: string[] = [], extra: NodeJS.ProcessEnv = {}) =>
      spawnSync("/bin/sh", [path.join(LAUNCHD, script), ...args], {
        encoding: "utf-8",
        env: { ...env, ...extra },
      }),
    target: path.join(root, "LaunchAgents", PLIST),
  };
};

test("install writes the agent for this checkout and loads it; uninstall unloads and removes it", () => {
  const mac = scratch("main");

  try {
    const installed = mac.run("install.sh", ["--now"]);
    assert.equal(installed.status, 0, installed.stderr);

    const plist = readFileSync(mac.target, "utf-8");
    assert.doesNotMatch(plist, /REPO/u);
    assert.match(
      plist,
      new RegExp(`<string>${mac.repo}/evals/nightly.sh</string>`, "u")
    );
    assert.match(
      mac.calls(),
      /^bootstrap gui\/\d+ .*dev\.outbound-sdk\.evals\.plist\nkickstart gui\/\d+\/dev\.outbound-sdk\.evals\n$/u
    );

    const removed = mac.run("uninstall.sh");
    assert.equal(removed.status, 0, removed.stderr);
    assert.equal(existsSync(mac.target), false);
    assert.match(mac.calls(), /bootout gui\/\d+\/dev\.outbound-sdk\.evals\n$/u);
    assert.equal(mac.run("uninstall.sh").status, 0);
  } finally {
    rmSync(mac.root, { force: true, recursive: true });
  }
});

test("install refuses a checkout off main, and an agent already installed", () => {
  const branch = scratch("task");

  try {
    const refused = branch.run("install.sh");
    assert.equal(refused.status, 1);
    assert.match(refused.stderr, /on task/u);
    assert.equal(existsSync(branch.target), false);
    assert.equal(branch.calls(), "");
  } finally {
    rmSync(branch.root, { force: true, recursive: true });
  }

  const mac = scratch("main");

  try {
    assert.equal(mac.run("install.sh").status, 0);
    const again = mac.run("install.sh");
    assert.equal(again.status, 1);
    assert.match(again.stderr, /already exists/u);
    assert.equal(mac.calls().split("\n").filter(Boolean).length, 1);
  } finally {
    rmSync(mac.root, { force: true, recursive: true });
  }
});

test("uninstall keeps the plist and fails when the agent is still loaded after bootout fails", () => {
  const mac = scratch("main");

  try {
    assert.equal(mac.run("install.sh").status, 0);

    const stuck = mac.run("uninstall.sh", [], {
      FAIL_BOOTOUT: "1",
      STILL_LOADED: "1",
    });

    assert.equal(stuck.status, 1);
    assert.match(stuck.stderr, /still loaded/u);
    assert.equal(existsSync(mac.target), true);

    const unloaded = mac.run("uninstall.sh", [], { FAIL_BOOTOUT: "1" });
    assert.equal(unloaded.status, 0, unloaded.stderr);
    assert.equal(existsSync(mac.target), false);

    assert.equal(mac.run("install.sh").status, 0);

    const missing = mac.run("uninstall.sh", [], {
      LAUNCHCTL: "/nonexistent/launchctl",
    });

    assert.equal(missing.status, 1);
    assert.equal(existsSync(mac.target), true);
  } finally {
    rmSync(mac.root, { force: true, recursive: true });
  }
});
