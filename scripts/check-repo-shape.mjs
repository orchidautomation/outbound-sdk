#!/usr/bin/env node

// Repository shape limits, ported from Felspar's check of the same name.
// Passing a review threshold is a warning; passing a hard limit fails.
// The limits are documented in docs/engineering-guardrails.md.

import { execFileSync } from "node:child_process";
import { readFileSync, statSync } from "node:fs";
import path from "node:path";

const KIB = 1024;
const MIB = 1024 * KIB;

const sourceExtensions = new Set([
  "bash",
  "cjs",
  "cts",
  "css",
  "go",
  "js",
  "jsx",
  "mjs",
  "mts",
  "py",
  "rb",
  "rs",
  "sh",
  "sql",
  "ts",
  "tsx",
  "zsh",
]);

const lockfiles = new Set([
  "bun.lock",
  "bun.lockb",
  "package-lock.json",
  "pnpm-lock.yaml",
  "yarn.lock",
]);

const forbiddenLocalState = [
  /^\.agent-artifacts\//u,
  /^\.codex\/(?:archived_sessions|sessions)\//u,
  /^\.entire\/(?:logs|metadata|tmp)\//u,
  /^\.scratch\//u,
  /^\.wrangler\//u,
];

const facadePattern = /(?:^|\/)index\.(?:cjs|cts|js|jsx|mjs|mts|ts|tsx)$/u;
const declarativePattern = /\.(?:csv|json|jsonc|toml|tsv|ya?ml)$/iu;

const testPattern =
  /(?:^|\/)(?:__tests__|test|tests)\/|\.(?:spec|test)\.[^.]+$/u;

const generatedPattern =
  /(?:^|\/)(?:generated|vendor)\/|\.(?:gen|generated)\.[^.]+$/u;

// Recorded vendor payloads are fixtures and may legitimately pass the
// declarative limit. Each entry needs a reason; trim the payload first.
export const fixtureAllowlistFile = "fixtures/large-fixtures.json";

const isEnvironmentFile = (file) => {
  const name = path.basename(file);

  return (
    name === ".dev.vars" ||
    name === ".env" ||
    (name.startsWith(".env.") && !name.endsWith(".example"))
  );
};

const lineCount = (contents) => {
  if (contents.length === 0) {
    return 0;
  }

  const text = contents.toString("utf-8");

  return text.split(/\r?\n/u).length - (text.endsWith("\n") ? 1 : 0);
};

const limitsFor = (file, contents) => {
  const name = path.basename(file);

  if (name === "SKILL.md") {
    return [200, 300, "skill-instruction"];
  }

  if (declarativePattern.test(file)) {
    return [800, 1200, "declarative-file"];
  }

  if (/\.md$/iu.test(file)) {
    return [800, 1200, "authored-Markdown"];
  }

  const isSource =
    sourceExtensions.has(path.extname(file).slice(1).toLowerCase()) ||
    (contents[0] === 0x23 && contents[1] === 0x21);

  if (!isSource) {
    return [800, 1200, "authored-text"];
  }

  if (testPattern.test(file)) {
    return [600, 900, "test-source"];
  }

  return facadePattern.test(file)
    ? [150, 250, "module-facade"]
    : [400, 600, "source-file"];
};

const readAllowlist = (root, trackedFiles) => {
  if (!trackedFiles.includes(fixtureAllowlistFile)) {
    return new Map();
  }

  const entries = JSON.parse(
    readFileSync(path.join(root, fixtureAllowlistFile), "utf-8")
  );

  return new Map(entries.map((entry) => [entry.file, entry.reason]));
};

const checkAgentsFile = (root, file, report) => {
  const isRoot = file === "AGENTS.md";
  const lines = lineCount(readFileSync(path.join(root, file)));
  const bytes = statSync(path.join(root, file)).size;

  const [reviewAt, hardLimit, byteLimit] = isRoot
    ? [80, 120, 12 * KIB]
    : [100, 150, 16 * KIB];

  if (lines > hardLimit) {
    report.errors.push(
      `${file}: ${lines} lines exceeds the ${hardLimit}-line hard limit`
    );
  } else if (lines > reviewAt) {
    report.warnings.push(
      `${file}: ${lines} lines exceeds the ${reviewAt}-line review threshold`
    );
  }

  if (bytes > byteLimit) {
    report.errors.push(
      `${file}: ${bytes} bytes exceeds the ${byteLimit / KIB} KiB hard limit`
    );
  }
};

const checkHygiene = (file, bytes, report) => {
  if (bytes > MIB && !lockfiles.has(path.basename(file))) {
    report.errors.push(
      `${file}: ${bytes} bytes exceeds the 1 MiB tracked-file limit`
    );
  }

  if (isEnvironmentFile(file)) {
    report.errors.push(
      `${file}: secret-bearing environment files must not be tracked`
    );
  }

  if (path.basename(file) === ".DS_Store") {
    report.errors.push(
      `${file}: operating-system metadata must not be tracked`
    );
  }

  if (forbiddenLocalState.some((pattern) => pattern.test(file))) {
    report.errors.push(
      `${file}: local agent or tool state must not be tracked`
    );
  }
};

const checkLines = (root, file, allowlist, report) => {
  if (generatedPattern.test(file) || lockfiles.has(path.basename(file))) {
    return;
  }

  const contents = readFileSync(path.join(root, file));

  if (contents.includes(0) || path.basename(file) === "AGENTS.md") {
    return;
  }

  const lines = lineCount(contents);
  const [reviewAt, hardLimit, surface] = limitsFor(file, contents);

  if (lines > hardLimit && allowlist.has(file)) {
    if (!allowlist.get(file)) {
      report.errors.push(
        `${file}: its ${fixtureAllowlistFile} entry needs a reason`
      );
    }

    return;
  }

  if (lines > hardLimit) {
    report.errors.push(
      `${file}: ${lines} lines exceeds the ${hardLimit}-line ${surface} hard limit`
    );
  } else if (lines > reviewAt) {
    report.warnings.push(
      `${file}: ${lines} lines exceeds the ${reviewAt}-line ${surface} review threshold`
    );
  }
};

export const checkRepository = (root) => {
  const trackedFiles = execFileSync("git", ["ls-files", "-z"], {
    cwd: root,
    encoding: "utf-8",
    stdio: ["ignore", "pipe", "pipe"],
  })
    .split("\0")
    .filter(
      (file) =>
        file && statSync(path.join(root, file), { throwIfNoEntry: false })
    );

  const report = {
    errors: [],
    trackedFiles: trackedFiles.length,
    warnings: [],
  };

  const allowlist = readAllowlist(root, trackedFiles);

  for (const file of trackedFiles) {
    checkHygiene(file, statSync(path.join(root, file)).size, report);
    checkLines(root, file, allowlist, report);
  }

  for (const file of allowlist.keys()) {
    if (!file.startsWith("fixtures/")) {
      report.errors.push(
        `${file}: only files under fixtures/ may be allowlisted`
      );
    }
  }

  const agentsFiles = trackedFiles.filter(
    (file) => path.basename(file) === "AGENTS.md"
  );

  if (!agentsFiles.includes("AGENTS.md")) {
    report.errors.push(
      "AGENTS.md: required root agent instructions are not tracked"
    );
  }

  for (const file of agentsFiles) {
    checkAgentsFile(root, file, report);
  }

  return report;
};

if (process.argv[1] && import.meta.filename === path.resolve(process.argv[1])) {
  const root = execFileSync("git", ["rev-parse", "--show-toplevel"], {
    encoding: "utf-8",
  }).trim();

  const report = checkRepository(root);

  for (const warning of report.warnings) {
    console.warn(`WARN ${warning}`);
  }

  for (const error of report.errors) {
    console.error(`FAIL ${error}`);
  }

  if (report.errors.length > 0) {
    process.exit(1);
  }

  console.log(
    `Repository shape OK (${report.trackedFiles} tracked files, ${report.warnings.length} warning(s))`
  );
}
