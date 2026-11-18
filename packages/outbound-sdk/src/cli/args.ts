// The command line: parsed, checked against the command it names, and the
// help it prints.

import { parseArgs } from "node:util";

import { OutboundError } from "../internal/errors.ts";
import { checkFlags, COMMANDS } from "./commands.ts";
import type { CommandSpec } from "./commands.ts";
import { OPTIONS } from "./options.ts";
import { didYouMean } from "./suggest.ts";
import { STANDALONE } from "./update.ts";

const GLOBAL_HELP = [
  "Options:",
  "  --provider <id>          the adapter to use, or all for every provider whose key is set (default: OUTBOUND_SDK_PROVIDER)",
  "  --compact                print JSON on one line",
  "  --raw                    keep each record's raw vendor payload (left out by default)",
  "  --config <file>          load plugins from a file whose default export is defineConfig({ plugins })",
  "  --redact                 mask personal fields (on by default for mcp)",
  "  --no-redact              do not mask personal fields, even for mcp",
  "  --cache <seconds>        reuse an answer for this long, within this process (for mcp; use a config-file store to persist)",
  "  --max-requests <n>       the most vendor requests one command, or one MCP tool call, may make",
  "",
  "Each adapter reads its own key from the environment, for example INSTANTLY_API_KEY.",
  "OUTBOUND_REDACT_KEY, a secret of at least 32 characters, gives redact the same tokens in every run.",
];

/** Every command with its options, then the options every command takes. */
const helpText = (): string =>
  [
    "outbound: read-only access to outbound sending tools",
    "",
    "Usage: outbound <command> [options]",
    "",
    "  providers",
    ...[...COMMANDS.values()].map((command) => `  ${command.help}`),
    "  mcp [--tools a,b,...] [--time-budget <seconds>]",
    "                           start a local MCP server on stdio (redact is on); --tools offers only the tools named;",
    "                           --time-budget is how long one tool call may take before it answers with what it read (default: 50)",
    "  version                  print the installed version (also --version, -v)",
    "  update                   check npm for a newer version and say how to get it",
    "",
    ...GLOBAL_HELP,
  ].join("\n");

/** One command's options, then the options every command takes. */
const commandHelp = (command: CommandSpec): string =>
  [`Usage: outbound ${command.help}`, "", ...GLOBAL_HELP].join("\n");

const STRING_OPTIONS: ReadonlySet<string> = new Set(
  Object.entries(OPTIONS).flatMap(([name, option]) =>
    option.type === "string" ? [`--${name}`] : []
  )
);

/**
 * `--limit -5` as `--limit=-5`, so a negative number is checked as the
 * option's value and refused with the option's own message. parseArgs would
 * otherwise refuse it as an ambiguous option, in words of its own.
 */
const joinNegatives = (argv: readonly string[]): string[] => {
  const joined: string[] = [];

  for (const arg of argv) {
    const option = joined.at(-1);

    if (
      option !== undefined &&
      STRING_OPTIONS.has(option) &&
      /^-\d/u.test(arg)
    ) {
      joined[joined.length - 1] = `${option}=${arg}`;
    } else {
      joined.push(arg);
    }
  }

  return joined;
};

const PARSE_ERROR = /^ERR_PARSE_ARGS_/u;

const isParseError = (error: unknown): error is Error & { code: string } =>
  error instanceof Error &&
  "code" in error &&
  typeof error.code === "string" &&
  PARSE_ERROR.test(error.code);

// What parseArgs still refuses, such as an option given no value, as one line
// of the CLI's own `Invalid`.
const parseStrict = (argv: readonly string[]) => {
  try {
    return parseArgs({
      allowPositionals: true,
      args: [...argv],
      options: OPTIONS,
    });
  } catch (error) {
    if (!isParseError(error)) {
      throw error;
    }

    const [line = error.message] = error.message.split("\n");

    throw new OutboundError("Invalid", line, { cause: error });
  }
};

export interface Parsed {
  readonly name: string | undefined;
  readonly rest: readonly string[];
  readonly values: ReturnType<typeof parseStrict>["values"];
  /** The help to print instead of running anything. */
  readonly help: string | undefined;
}

const helpFor = (name: string | undefined, asked: boolean) => {
  const command = name === undefined ? undefined : COMMANDS.get(name);

  if (name === undefined || name === "help" || (asked && !command)) {
    return helpText();
  }

  return asked && command ? commandHelp(command) : undefined;
};

/**
 * The arguments, checked against the command they name: a flag it does not
 * take is refused with the command's name, never ignored.
 */
export const parse = (given: readonly string[]): Parsed => {
  const argv = joinNegatives(given);

  const loose = parseArgs({
    allowPositionals: true,
    args: [...argv],
    options: OPTIONS,
    strict: false,
    tokens: true,
  });

  const [name] = loose.positionals;
  const command = name === undefined ? undefined : COMMANDS.get(name);
  const named = name !== undefined && name !== "help";

  if (named && !command && !STANDALONE.has(name)) {
    throw new OutboundError(
      "Invalid",
      `Unknown command "${name}".${didYouMean(name, [...COMMANDS.keys(), ...STANDALONE.keys(), "help", "providers"])} Run "outbound help"`
    );
  }

  if (named) {
    checkFlags(
      name,
      command?.flags ?? STANDALONE.get(name) ?? [],
      loose.tokens.flatMap((token) =>
        token.kind === "option" ? [token.name] : []
      )
    );
  }

  const { positionals, values } = parseStrict(argv);

  return {
    help: helpFor(name, values.help === true),
    name,
    rest: positionals.slice(1),
    values,
  };
};
