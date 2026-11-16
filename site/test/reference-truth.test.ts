// Holds the site's reference tables to the code they describe: the CLI's
// commands and flags, the built-in tools, the error codes and the capability
// keys. Adding, removing or renaming one of them without changing its page
// fails here, in the same pull request.

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { test } from "node:test";

import { run } from "../../packages/outbound-sdk/src/cli/index.ts";
import { clients } from "../../packages/outbound-sdk/src/clients/index.ts";
import { identity } from "../../packages/outbound-sdk/src/identity/index.ts";
import {
  CAPABILITY_KEYS,
  createOutbound,
} from "../../packages/outbound-sdk/src/index.ts";
import type { OutboundErrorCode } from "../../packages/outbound-sdk/src/index.ts";
import { memory } from "../../packages/outbound-sdk/src/memory/index.ts";
import {
  createTools,
  TOOL_NAMES,
} from "../../packages/outbound-sdk/src/tools/index.ts";

// The pages spell a count out: "the twelve tools".
const NUMBER_WORDS = [
  "zero",
  "one",
  "two",
  "three",
  "four",
  "five",
  "six",
  "seven",
  "eight",
  "nine",
  "ten",
  "eleven",
  "twelve",
  "thirteen",
  "fourteen",
  "fifteen",
  "sixteen",
  "seventeen",
  "eighteen",
  "nineteen",
  "twenty",
];

const DOCS = path.resolve(import.meta.dirname, "../content/docs");

const page = (file: string): string =>
  readFileSync(path.join(DOCS, file), "utf-8");

const sorted = (values: Iterable<string>): string[] => [...values].toSorted();

/** The lines under a heading, up to the next heading of the same or a higher level. */
const section = (text: string, heading: string): string => {
  const lines = text.split("\n");
  const start = lines.findIndex((line) => line.trim() === heading);
  assert.ok(start !== -1, `the page has a "${heading}" heading`);

  const level = heading.indexOf(" ");

  const end = lines.findIndex(
    (line, index) =>
      index > start && /^#+ /u.test(line) && line.indexOf(" ") <= level
  );

  return lines.slice(start + 1, end === -1 ? undefined : end).join("\n");
};

const isSeparator = (line: string): boolean =>
  /^\|(?:\s*:?-+:?\s*\|)+$/u.test(line.trim());

/**
 * The body rows of every table in some text, as trimmed cells. A header row
 * is the one right above a separator row. `\|` stays in its cell.
 */
const tableRows = (text: string): string[][] => {
  const lines = text.split("\n");

  return lines.flatMap((line, index) =>
    !line.trim().startsWith("|") ||
    isSeparator(line) ||
    isSeparator(lines[index + 1] ?? "")
      ? []
      : [
          line
            .trim()
            .split(/(?<!\\)\|/u)
            .slice(1, -1)
            .map((cell) => cell.trim()),
        ]
  );
};

/** Every `code span` in a cell, without the backticks. */
const spans = (cell: string): string[] =>
  [...cell.matchAll(/`(?<span>[^`]+)`/gu)].map(
    (match) => match.groups?.span ?? ""
  );

/** Every `--flag` named in a piece of text. */
const flagsIn = (text: string): string[] =>
  [...text.matchAll(/--(?<flag>[a-z][a-z-]*)/gu)].map(
    (match) => match.groups?.flag ?? ""
  );

test("the table helpers read the tables the pages use", () => {
  const text = [
    "## A",
    "",
    "| Flag | Commands | Meaning |",
    "| --- | --- | --- |",
    "| `--by day\\|total` | `stats`, `campaign --stats` | x |",
    "### Inside A",
    "| `--x` | all | y |",
    "## B",
    "| `--z` | all | z |",
  ].join("\n");

  const rows = tableRows(section(text, "## A"));
  assert.deepEqual(
    rows.map((cells) => cells[0]),
    ["`--by day\\|total`", "`--x`"]
  );
  assert.deepEqual(spans(rows[0]?.[1] ?? ""), ["stats", "campaign --stats"]);
  assert.deepEqual(flagsIn("[--from YYYY-MM-DD] [--card | --slack]"), [
    "from",
    "card",
    "slack",
  ]);
  assert.throws(() => section(text, "## C"), /"## C" heading/u);
});

// --- The CLI ---------------------------------------------------------------

const helpText = async (): Promise<string> => {
  let out = "";

  const code = await run(["help"], {
    stderr: (text) => {
      out += text;
    },
    stdout: (text) => {
      out += text;
    },
  });

  assert.equal(code, 0);

  return out;
};

/** What `outbound help` prints: each command with its flags, and the flags every command takes. */
const cliUsage = async (): Promise<{
  commands: Map<string, string[]>;
  global: string[];
}> => {
  const [usage = "", options = ""] = (await helpText()).split("\nOptions:\n");

  const commands = new Map(
    usage
      .split("\n")
      .filter((line) => /^ {2}[a-z]/u.test(line))
      .map((line) => {
        const [name = ""] = line.trim().split(/\s/u);

        return [name, flagsIn(line)] as const;
      })
  );

  return { commands, global: flagsIn(options) };
};

// Named on the page but not in the usage text: `outbound --help` and `-h`
// print the usage, and `help` is that same command spelled out.
const IMPLIED_COMMANDS = ["help"];
const IMPLIED_FLAGS = new Set(["help"]);

test("the CLI page lists every command the CLI has, and no other", async () => {
  const { commands } = await cliUsage();
  const rows = tableRows(section(page("cli/commands.mdx"), "## All commands"));

  const documented = rows.map((cells) => {
    const [command = ""] = spans(cells[0] ?? "");

    return command.split(" ")[0] ?? "";
  });

  assert.deepEqual(
    sorted(documented),
    sorted([...commands.keys(), ...IMPLIED_COMMANDS]),
    "the command names in cli/commands.mdx § All commands are the ones `outbound help` prints"
  );
});

test("the CLI page lists every flag, against the commands that take it", async () => {
  const { commands, global } = await cliUsage();
  const text = page("cli/commands.mdx");
  const rows = tableRows(section(text, "## Flags"));

  // `--version` and `-v` are named beside the `version` command instead.
  const seen = new Set(flagsIn(section(text, "## All commands")));

  for (const [flagCell = "", commandsCell = ""] of rows) {
    const named = spans(commandsCell).map((span) => span.split(" ")[0] ?? "");

    for (const flag of flagsIn(flagCell)) {
      seen.add(flag);

      if (named.length === 0) {
        // "all", "all that need an adapter", "all that print JSON".
        assert.ok(
          global.includes(flag) || IMPLIED_FLAGS.has(flag),
          `cli/commands.mdx says every command takes --${flag}, but \`outbound help\` does not list it under Options`
        );
        continue;
      }

      const takers = [...commands].flatMap(([name, flags]) =>
        flags.includes(flag) ? [name] : []
      );

      assert.deepEqual(
        sorted(new Set(named)),
        sorted(takers),
        `cli/commands.mdx says which commands take --${flag}; \`outbound help\` says otherwise`
      );
    }
  }

  const every = new Set([...global, ...[...commands.values()].flat()]);

  for (const flag of every) {
    assert.ok(seen.has(flag), `cli/commands.mdx § Flags documents --${flag}`);
  }
});

// --- Built-in tools --------------------------------------------------------

test("the tools page lists every built-in tool with what it needs, and no other", () => {
  // Both plugins on, so the two tools that need one are built too.
  const outbound = createOutbound({
    adapter: memory(),
    plugins: [clients(), identity()],
  });

  const needs = new Map(
    createTools(outbound, { only: [...TOOL_NAMES] }).map((tool) => [
      tool.name,
      tool.needs,
    ])
  );

  const text = page("tools/index.mdx");
  const count = NUMBER_WORDS[TOOL_NAMES.length];
  assert.ok(count !== undefined, "NUMBER_WORDS spells the tool count");
  assert.match(text, new RegExp(`lists all ${count} names`, "u"));

  const rows = tableRows(section(text, `## The ${count} tools`));

  assert.deepEqual(
    sorted(rows.map((cells) => spans(cells[0] ?? "")[0] ?? "")),
    sorted(TOOL_NAMES),
    "tools/index.mdx lists exactly TOOL_NAMES"
  );

  for (const [toolCell = "", , needsCell = ""] of rows) {
    const [name = ""] = spans(toolCell);
    const expected = needs.get(name);

    // vendor_read needs vendor reads, which the in-memory adapter has none of.
    if (expected === undefined) {
      continue;
    }

    // A plugin is named by a link, `[`clients` plugin](...)`, a capability as a span.
    assert.deepEqual(
      sorted(spans(needsCell)),
      sorted(expected),
      `tools/index.mdx says what ${name} needs; the tool says otherwise`
    );
  }
});

// --- Error codes -----------------------------------------------------------

// `satisfies` makes the type check fail when a code is added to or removed
// from `OutboundErrorCode` and not here, so this list cannot go stale.
const ERROR_CODES = {
  Invalid: true,
  NotFound: true,
  Provider: true,
  RateLimited: true,
  Unauthorized: true,
  Unsupported: true,
} as const satisfies Record<OutboundErrorCode, true>;

test("the errors page lists every error code, and no other", () => {
  const rows = tableRows(section(page("api/errors.mdx"), "## Codes"));

  assert.deepEqual(
    sorted(rows.map((cells) => spans(cells[0] ?? "")[0] ?? "")),
    sorted(Object.keys(ERROR_CODES)),
    "api/errors.mdx § Codes lists exactly the OutboundErrorCode values"
  );
});

// --- Capability keys -------------------------------------------------------

test("the capabilities page lists every capability key once, and counts them", () => {
  const text = page("capabilities.mdx");
  const rows = tableRows(section(text, "## Every key"));
  const documented = rows.map((cells) => spans(cells[0] ?? "")[0] ?? "");

  assert.deepEqual(
    sorted(documented),
    sorted(CAPABILITY_KEYS),
    "capabilities.mdx § Every key lists exactly CAPABILITY_KEYS, each once"
  );
  assert.match(
    text,
    new RegExp(`the list of all ${CAPABILITY_KEYS.length}\\.`, "u")
  );
});
