// Runs every code sample the documentation shows. A sample is a file under
// site/content/_examples/, spliced into a page with <include>. Each file that
// no sibling imports is a script: it must exit 0 and, when a `<name>.out.txt`
// sits beside it, print exactly that. Pages may not carry TypeScript of
// their own, so nothing reaches the site without having been run.
//
// UPDATE_EXAMPLES=1 npm test rewrites the recorded outputs.

import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { existsSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { test } from "node:test";
import { promisify } from "node:util";

const ROOT = path.resolve(import.meta.dirname, "../..");
const CONTENT = path.join(ROOT, "site/content");
const EXAMPLES = path.join(CONTENT, "_examples");
const LOADER = path.join(ROOT, "scripts/examples-loader.mjs");
const UPDATE = process.env.UPDATE_EXAMPLES === "1";

const run = promisify(execFile);

const walk = (dir: string): string[] =>
  readdirSync(dir, { withFileTypes: true }).flatMap((entry) =>
    entry.isDirectory()
      ? walk(path.join(dir, entry.name))
      : [path.join(dir, entry.name)]
  );

const files = existsSync(EXAMPLES) ? walk(EXAMPLES) : [];
const sources = files.filter((file) => file.endsWith(".ts"));

const imported = new Set(
  sources.flatMap((file) =>
    [
      ...readFileSync(file, "utf-8").matchAll(
        /^(?:import|export) (?!type )[^;]*?from "(?<to>\.[^"]+)"/gmsu
      ),
    ].map((match) => path.resolve(path.dirname(file), match.groups?.to ?? ""))
  )
);

const scripts = sources.filter((file) => !imported.has(file));
const label = (file: string): string => path.relative(EXAMPLES, file);

// Keys that look real enough for an adapter to be constructed. No request
// can leave: the loader replaces fetch.
const ENV = {
  HEYREACH_API_KEY: "example-key",
  INSTANTLY_API_KEY: "example-key",
  NO_COLOR: "1",
  PATH: process.env.PATH ?? "",
  SMARTLEAD_API_KEY: "example-key",
  TZ: "UTC",
};

for (const script of scripts) {
  test(`example ${label(script)} runs`, async () => {
    const { stdout } = await run(
      process.execPath,
      ["--import", LOADER, "--no-warnings", script],
      { cwd: path.dirname(script), env: ENV, timeout: 60_000 }
    );

    const recorded = script.replace(/\.ts$/u, ".out.txt");

    if (UPDATE && stdout.length > 0) {
      writeFileSync(recorded, stdout);
    }

    if (existsSync(recorded)) {
      assert.equal(stdout, readFileSync(recorded, "utf-8"));
    } else {
      assert.equal(
        stdout,
        "",
        `${label(script)} prints, so record it: UPDATE_EXAMPLES=1 npm test`
      );
    }
  });
}

test("every recorded output belongs to a script", () => {
  for (const file of files.filter((name) => name.endsWith(".out.txt"))) {
    assert.ok(
      scripts.includes(file.replace(/\.out\.txt$/u, ".ts")),
      `${label(file)} has no script beside it`
    );
  }
});

const pages = walk(CONTENT).filter(
  (file) => /\.mdx?$/u.test(file) && !file.startsWith(EXAMPLES)
);

// A fence a page may write itself: commands, configuration and plain text.
// Anything that is a program belongs in _examples, where it is run.
const FENCE = /^[\s>*-]*(?:`{3,}|~{3,})[ \t]*(?<language>[\w-]*)/gmu;

const PLAIN = new Set([
  "",
  "console",
  "diff",
  "json",
  "mdx",
  "sh",
  "sql",
  "text",
  "toml",
  "yaml",
]);

const INCLUDE = /<include[^>]*>\s*(?<target>[^<\s]+)\s*<\/include>/gu;

test("no page carries code that was not run", () => {
  for (const page of pages) {
    const text = readFileSync(page, "utf-8");
    assert.doesNotMatch(
      text,
      /<pre[\s>]/u,
      `${path.relative(ROOT, page)}: <pre>`
    );

    for (const match of text.matchAll(FENCE)) {
      const language = match.groups?.language ?? "";

      assert.ok(
        PLAIN.has(language),
        `${path.relative(ROOT, page)}: a \`${language}\` fence. Move the code to site/content/_examples/ and <include> it`
      );
    }
  }
});

test("an example is a script, its recorded output, or data it reads", () => {
  for (const file of files) {
    assert.match(file, /\.(?:ts|out\.txt|json|sql)$/u, label(file));
  }
});

test("every included example exists, and every example is included", () => {
  const used = new Set<string>();

  for (const page of pages) {
    for (const match of readFileSync(page, "utf-8").matchAll(INCLUDE)) {
      const target = match.groups?.target ?? "";

      const file = target.startsWith("/")
        ? path.join(CONTENT, target)
        : path.resolve(path.dirname(page), target);

      assert.ok(
        existsSync(file),
        `${path.relative(ROOT, page)} includes ${target}, which does not exist`
      );
      used.add(file);
    }
  }

  for (const file of files) {
    assert.ok(used.has(file), `${label(file)} is not shown on any page`);
  }
});

// A standalone app under examples/ deploys a file the site also shows. The
// site's copy is the one that is run, so the two must not drift apart.
const SHARED_WITH_APPS = [
  ["examples/executor-outbound/outbound.ts", "executor/outbound.ts"],
] as const;

test("a file an example app shares with the site is the same in both", () => {
  for (const [app, sample] of SHARED_WITH_APPS) {
    assert.equal(
      readFileSync(path.join(ROOT, app), "utf-8"),
      readFileSync(path.join(EXAMPLES, sample), "utf-8"),
      `${app} and site/content/_examples/${sample} differ. Copy one over the other`
    );
  }
});
