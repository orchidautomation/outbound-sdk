// outbound-sdk/cli: the `outbound` command and the local MCP server.

import { parseArgs } from "node:util";

import type { Adapter } from "../internal/adapter.ts";
import { OutboundError } from "../internal/errors.ts";
import { field } from "../internal/json.ts";
import type { OutboundApi } from "../internal/outbound/api.ts";
import { createOutbound } from "../internal/outbound/create.ts";
import { fromEnv } from "../loader/index.ts";
import { createTools } from "../tools/index.ts";
import {
  checkFlags,
  commandHelp,
  COMMANDS,
  helpText,
  listProviders,
} from "./commands.ts";
import { pluginsFor } from "./config.ts";
import { createMcpServer } from "./mcp.ts";
import { printAnswer } from "./output.ts";
import { serveStdio } from "./stdio.ts";
import { didYouMean } from "./suggest.ts";
import { runNpm, runSelf, STANDALONE } from "./update.ts";
import { packageVersion } from "./version.ts";

export { defineConfig } from "./config.ts";

export type { CliConfig } from "./config.ts";

export { createMcpServer, PROTOCOL_VERSIONS } from "./mcp.ts";

export type { McpServer, McpServerOptions } from "./mcp.ts";

export { serveStdio } from "./stdio.ts";

export type { NpmRunner } from "./update.ts";

export type { StdioOptions } from "./stdio.ts";

export interface CliIo {
  readonly stdout: (text: string) => void;
  readonly stderr: (text: string) => void;
  /** Opens standard input as lines. Called only by `outbound mcp`, so other commands exit when done. */
  readonly stdin?: (() => AsyncIterable<string> | Iterable<string>) | undefined;
  /** Replaces the adapter the environment would choose. Meant for tests. */
  readonly adapter?: Adapter | undefined;
  /** Runs npm for `outbound update` and resolves to its output. Meant for tests. */
  readonly npm?: ((args: readonly string[]) => Promise<string>) | undefined;
}

const OPTIONS = {
  bodies: { type: "boolean" },
  by: { type: "string" },
  cache: { type: "string" },
  campaign: { type: "string" },
  card: { type: "boolean" },
  category: { type: "string" },
  compact: { type: "boolean" },
  config: { type: "string" },
  from: { type: "string" },
  help: { short: "h", type: "boolean" },
  input: { type: "string" },
  limit: { type: "string" },
  list: { type: "string" },
  "max-requests": { type: "string" },
  "no-redact": { type: "boolean" },
  provider: { type: "string" },
  raw: { type: "boolean" },
  redact: { type: "boolean" },
  search: { type: "string" },
  sequence: { type: "boolean" },
  settings: { type: "boolean" },
  since: { type: "string" },
  slack: { type: "boolean" },
  stats: { type: "boolean" },
  status: { type: "string" },
  subsequences: { type: "boolean" },
  to: { type: "string" },
  version: { short: "v", type: "boolean" },
} as const;

const serve = async (
  outbound: OutboundApi,
  io: CliIo,
  unmasked: OutboundApi | undefined
): Promise<void> => {
  // Loaded on demand, so the other commands do not pay for the insights.
  const { insightTools } = await import("../insights/index.ts");

  const offered = (instance: OutboundApi) =>
    createTools(instance, { extra: insightTools(instance) }).map(
      (tool) => tool.name
    );

  // A tool offered without redact but not with it was left out by redact.
  const here = new Set(offered(outbound));

  const leftOut = Object.fromEntries(
    (unmasked === undefined ? [] : offered(unmasked))
      .filter((name) => !here.has(name))
      .map((name) => [
        name,
        `${name} is left out while the redact plugin is on: it needs what redact masks. Start the server with --no-redact to offer it; personal fields are then not masked.`,
      ])
  );

  const server = createMcpServer(outbound, {
    extra: insightTools(outbound),
    leftOut,
    version: packageVersion(),
  });

  await serveStdio(server, { input: io.stdin?.() ?? [], write: io.stdout });
};

const parseStrict = (argv: readonly string[]) =>
  parseArgs({ allowPositionals: true, args: [...argv], options: OPTIONS });

interface Parsed {
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
const parse = (argv: readonly string[]): Parsed => {
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

/** Runs the CLI. Returns the process exit code. */
export const run = async (
  argv: readonly string[],
  io: CliIo
): Promise<number> => {
  try {
    const { help, name, rest, values } = parse(argv);

    if (await runSelf(name, values, io.npm ?? runNpm, io.stdout)) {
      return 0;
    }

    if (help !== undefined) {
      io.stdout(help);

      return 0;
    }

    if (name === "providers") {
      printAnswer(io.stdout, listProviders(), values);

      return 0;
    }

    // `parse` refused an unknown command, so no command here is `mcp`.
    const command = name === undefined ? undefined : COMMANDS.get(name);

    const adapter =
      io.adapter ?? (await fromEnv({ provider: values.provider }));

    const plugins = await pluginsFor(values, command === undefined, io.stderr);
    const outbound = createOutbound({ adapter, plugins });

    if (command === undefined) {
      // The same instance without redact, to tell which tools redact left out.
      const unmasked = plugins.some((plugin) => plugin.name === "redact")
        ? createOutbound({
            adapter,
            plugins: plugins.filter((plugin) => plugin.name !== "redact"),
          })
        : undefined;

      await serve(outbound, io, unmasked);

      return 0;
    }

    const answer = await command.run(outbound, {
      flags: values,
      note: io.stderr,
      positionals: rest,
    });

    printAnswer(io.stdout, answer, values);

    // A tool never throws: its failure is a result, printed like any other.
    // The exit code still says the command did not get an answer.
    return name === "tool" && field(answer, "ok") === false ? 1 : 0;
  } catch (error) {
    const code = OutboundError.is(error) ? error.code : "Error";
    io.stderr(
      `${code}: ${error instanceof Error ? error.message : String(error)}`
    );

    return 1;
  }
};
