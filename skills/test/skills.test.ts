// Holds the agent skills under skills/ to the SDK. A skill may only describe
// behaviour the SDK has, so everything in one that can be run is run:
//
// - every script in a skill's examples/ runs and prints its recorded output,
//   the way the documentation site's samples do (site/test/examples.test.ts)
// - every `outbound …` line in a `sh` block runs through the real CLI, on the
//   in-memory adapter, and must exit 0
// - every link resolves: a relative one to a file in the same skill, an
//   outbound-sdk.dev one to a page of the site
// - the question map names every tool and insight, and nothing else
//
// UPDATE_EXAMPLES=1 npm test rewrites the recorded outputs.

import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { existsSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { test } from "node:test";
import { promisify } from "node:util";

import { run } from "../../packages/outbound-sdk/src/cli/index.ts";
import { listInsights } from "../../packages/outbound-sdk/src/insights/index.ts";
import { TOOL_NAMES } from "../../packages/outbound-sdk/src/tools/index.ts";

const ROOT = path.resolve(import.meta.dirname, "../..");
const SKILLS = path.join(ROOT, "skills");
const SITE = path.join(ROOT, "site/content");
const LOADER = path.join(ROOT, "scripts/examples-loader.mjs");
const UPDATE = process.env.UPDATE_EXAMPLES === "1";

const execute = promisify(execFile);

const walk = (dir: string): string[] =>
  existsSync(dir)
    ? readdirSync(dir, { withFileTypes: true }).flatMap((entry) =>
        entry.isDirectory()
          ? walk(path.join(dir, entry.name))
          : [path.join(dir, entry.name)]
      )
    : [];

const skills = readdirSync(SKILLS, { withFileTypes: true })
  .filter((entry) => entry.isDirectory() && entry.name !== "test")
  .map((entry) => entry.name);

const markdownOf = (skill: string): string[] =>
  walk(path.join(SKILLS, skill)).filter((file) => file.endsWith(".md"));

const relative = (file: string): string => path.relative(ROOT, file);

test("there are skills, each with a SKILL.md", () => {
  assert.ok(skills.length > 0);

  for (const skill of skills) {
    assert.ok(
      existsSync(path.join(SKILLS, skill, "SKILL.md")),
      `skills/${skill} has a SKILL.md`
    );
  }
});

for (const skill of skills) {
  test(`${skill}: frontmatter names the skill and describes when to use it`, () => {
    const text = readFileSync(path.join(SKILLS, skill, "SKILL.md"), "utf-8");
    const front = /^---\n(?<body>[\s\S]*?)\n---\n/u.exec(text)?.groups?.body;

    assert.ok(front, "SKILL.md starts with --- frontmatter ---");

    const field = (key: string): string =>
      new RegExp(`^${key}: (?<value>.+)$`, "mu").exec(front)?.groups?.value ??
      "";

    assert.equal(field("name"), skill, "name is the folder name");
    assert.match(skill, /^[a-z0-9]+(?:-[a-z0-9]+)*$/u);
    assert.ok(skill.length <= 64);

    const description = field("description");

    assert.ok(description.length > 0, "description is set");
    assert.ok(
      description.length <= 1024,
      "description is 1024 characters or fewer"
    );
    assert.match(description, /Use when/u, "description says when to use it");
  });
}

// Fences a skill may write itself: commands, configuration and plain text.
// A program belongs in examples/, where it is run.
const FENCE = /^[\s>*-]*(?:`{3,}|~{3,})[ \t]*(?<language>[\w-]*)/gmu;
const PLAIN = new Set(["", "console", "json", "sh", "text", "yaml"]);

for (const skill of skills) {
  test(`${skill}: no block of code that is not run`, () => {
    for (const file of markdownOf(skill)) {
      const text = readFileSync(file, "utf-8");

      for (const match of text.matchAll(FENCE)) {
        const language = match.groups?.language ?? "";

        assert.ok(
          PLAIN.has(language),
          `${relative(file)}: a \`${language}\` block. Move it to examples/ and link it`
        );
      }
    }
  });
}

const LINK = /\]\((?<target>[^)\s]+)\)/gu;
const SITE_URL = "https://outbound-sdk.dev";

/** The site page a path on outbound-sdk.dev is built from. */
const sitePage = (route: string): boolean => {
  const clean = route.replaceAll(/^\/+|\/+$/gu, "");

  if (clean === "llms.txt" || clean === "llms-full.txt") {
    return true;
  }

  const base = path.join(SITE, clean);

  return [`${base}.mdx`, path.join(base, "index.mdx")].some((file) =>
    existsSync(file)
  );
};

for (const skill of skills) {
  test(`${skill}: every link resolves, and every example is linked`, () => {
    const folder = path.join(SKILLS, skill);
    const linked = new Set<string>();

    for (const file of markdownOf(skill)) {
      for (const match of readFileSync(file, "utf-8").matchAll(LINK)) {
        const target = (match.groups?.target ?? "").split("#")[0] ?? "";

        if (target.startsWith(SITE_URL)) {
          assert.ok(
            sitePage(target.slice(SITE_URL.length)),
            `${relative(file)} links to ${target}, which is not a page of the site`
          );
        } else if (!/^[a-z]+:/u.test(target) && target !== "") {
          const resolved = path.resolve(path.dirname(file), target);

          assert.ok(
            resolved.startsWith(`${folder}${path.sep}`),
            `${relative(file)} links outside its skill: ${target}. A skill is installed on its own`
          );
          assert.ok(
            existsSync(resolved),
            `${relative(file)} links to ${target}, which does not exist`
          );
          linked.add(resolved);
        }
      }
    }

    for (const file of walk(path.join(folder, "examples"))) {
      assert.ok(
        linked.has(file),
        `${relative(file)} is not linked from the skill`
      );
    }
  });
}

// The same rule as the site: while the package is unpublished, no install
// command for it unless the line says it does not work.
const INSTALL =
  /(?:npm (?:i|install|add)|pnpm add|yarn add|bun add|npx(?: -y)?) +(?:-\S+ +)*outbound-sdk(?![\w/-]*\.tgz)/u;

// 0.1.0 was published to npm on 2026-11-15. Kept in step with the same
// constant in site/test/site-truth.test.ts.
const unpublished = false;

test("while the package is unpublished, no skill shows an install command for it", () => {
  if (!unpublished) {
    return;
  }

  for (const skill of skills) {
    for (const file of markdownOf(skill)) {
      for (const line of readFileSync(file, "utf-8").split("\n")) {
        if (INSTALL.test(line)) {
          assert.match(
            line,
            /does not|not work|not published|not on npm/iu,
            `${relative(file)} shows an install command without saying it does not work: ${line.trim()}`
          );
        }
      }
    }
  }
});

/** Splits one shell line into words, honouring single and double quotes. */
const words = (line: string): string[] =>
  [
    ...line.matchAll(
      /'(?<single>[^']*)'|"(?<double>[^"]*)"|(?<bare>[^\s'"]+)/gu
    ),
  ].map(
    (match) =>
      match.groups?.single ?? match.groups?.double ?? match.groups?.bare ?? ""
  );

const ASSIGNMENT = /^(?<key>[A-Z_][A-Z0-9_]*)=(?<value>\S*)$/u;

interface Command {
  readonly file: string;
  readonly line: string;
  readonly argv: string[];
  readonly env: Record<string, string>;
}

/** Moves leading `KEY=value` words from `parts` into `env`. */
const takeAssignments = (
  parts: string[],
  env: Record<string, string>
): void => {
  let assignment = ASSIGNMENT.exec(parts[0] ?? "")?.groups;

  while (assignment !== undefined) {
    env[assignment["key"] ?? ""] = assignment["value"] ?? "";
    parts.shift();
    assignment = ASSIGNMENT.exec(parts[0] ?? "")?.groups;
  }
};

/** The commands in one `sh` block. `export` lines carry on to later lines. */
const blockCommands = (file: string, body: string): Command[] => {
  const found: Command[] = [];
  const exported: Record<string, string> = {};

  for (const raw of body.split("\n")) {
    const line = raw.replace(/\s+#.*$/u, "").trim();
    const parts = words(line);

    if (parts[0] === "export") {
      takeAssignments(parts.slice(1), exported);
      continue;
    }

    const env = { ...exported };

    takeAssignments(parts, env);

    if (parts[0] === "npx") {
      parts.shift();
    }

    // The package installs one executable under both names.
    if (
      (parts[0] === "outbound" || parts[0] === "outbound-sdk") &&
      parts[1] !== "mcp"
    ) {
      found.push({ argv: parts.slice(1), env, file, line });
    }
  }

  return found;
};

/** Every `outbound …` or `npx outbound-sdk …` line in a `sh` block. */
const commands = (file: string): Command[] =>
  [
    ...readFileSync(file, "utf-8").matchAll(
      /^```sh\n(?<body>[\s\S]*?)^```$/gmu
    ),
  ].flatMap((block) => blockCommands(file, block.groups?.body ?? ""));

for (const skill of skills) {
  for (const command of markdownOf(skill).flatMap(commands)) {
    test(`${skill}: \`${command.line}\` runs`, async () => {
      const provider = command.env["OUTBOUND_SDK_PROVIDER"];

      assert.ok(
        provider === undefined || provider === "memory",
        "a command the test runs uses the in-memory adapter"
      );

      const saved = process.env["OUTBOUND_SDK_PROVIDER"];
      const output: string[] = [];

      if (provider === undefined) {
        delete process.env["OUTBOUND_SDK_PROVIDER"];
      } else {
        process.env["OUTBOUND_SDK_PROVIDER"] = provider;
      }

      try {
        const code = await run(command.argv, {
          stderr: (text) => {
            output.push(text);
          },
          stdout: () => {},
        });

        assert.equal(
          code,
          0,
          `${relative(command.file)}: ${command.line}\n${output.join("\n")}`
        );
      } finally {
        if (saved === undefined) {
          delete process.env["OUTBOUND_SDK_PROVIDER"];
        } else {
          process.env["OUTBOUND_SDK_PROVIDER"] = saved;
        }
      }
    });
  }
}

// Keys that look real enough for an adapter to be constructed. No request can
// leave: the loader replaces fetch.
const ENV = {
  HEYREACH_API_KEY: "example-key",
  INSTANTLY_API_KEY: "example-key",
  NO_COLOR: "1",
  PATH: process.env.PATH ?? "",
  SMARTLEAD_API_KEY: "example-key",
  TZ: "UTC",
};

const sources = walk(SKILLS).filter(
  (file) =>
    file.endsWith(".ts") && file.includes(`${path.sep}examples${path.sep}`)
);

const imported = new Set(
  sources.flatMap((file) =>
    [
      ...readFileSync(file, "utf-8").matchAll(
        /(?:^(?:import|export) (?!type )[^;]*?from |import\()"(?<to>\.[^"]+)"/gmsu
      ),
    ].map((match) => path.resolve(path.dirname(file), match.groups?.to ?? ""))
  )
);

for (const script of sources.filter((file) => !imported.has(file))) {
  test(`${relative(script)} runs and prints what it recorded`, async () => {
    const { stdout } = await execute(
      process.execPath,
      ["--import", LOADER, "--no-warnings", script],
      { cwd: path.dirname(script), env: ENV, timeout: 60_000 }
    );

    const recorded = script.replace(/\.ts$/u, ".out.txt");

    if (UPDATE && stdout.length > 0) {
      writeFileSync(recorded, stdout);
    }

    assert.ok(
      existsSync(recorded),
      `${relative(script)} prints, so record it: UPDATE_EXAMPLES=1 npm test`
    );
    assert.equal(stdout, readFileSync(recorded, "utf-8"));
  });
}

test("every recorded output belongs to a script", () => {
  for (const file of walk(SKILLS).filter((name) => name.endsWith(".out.txt"))) {
    assert.ok(
      existsSync(file.replace(/\.out\.txt$/u, ".ts")),
      `${relative(file)} has no script beside it`
    );
  }
});

test("the question map names every tool and insight once, and nothing else", () => {
  const map = readFileSync(
    path.join(SKILLS, "outbound-sdk-answering/references/questions.md"),
    "utf-8"
  );

  const named = [...map.matchAll(/^\|[^|\n]+\| `(?<name>[a-z_]+)` \|$/gmu)].map(
    (match) => match.groups?.name ?? ""
  );

  const known = [
    ...TOOL_NAMES,
    ...listInsights().map((insight) => insight.name),
  ];

  assert.deepEqual(
    [...named].toSorted(),
    [...new Set(known)].toSorted(),
    "each tool and insight has exactly one row"
  );
});
