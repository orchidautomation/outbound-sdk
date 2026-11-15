// outbound-sdk/cli: the `outbound` command and the local MCP server.

import { parseArgs } from "node:util";

import type { Adapter } from "../internal/adapter.ts";
import { OutboundError } from "../internal/errors.ts";
import { field } from "../internal/json.ts";
import type { Json } from "../internal/json.ts";
import type { OutboundApi } from "../internal/outbound/api.ts";
import { createOutbound } from "../internal/outbound/create.ts";
import { fromEnv } from "../loader/index.ts";
import {
  checkFlags,
  commandHelp,
  COMMANDS,
  helpText,
  listProviders,
} from "./commands.ts";
import { pluginsFor } from "./config.ts";
import { createMcpServer } from "./mcp.ts";
import { serveStdio } from "./stdio.ts";
import { packageVersion } from "./version.ts";

export { defineConfig } from "./config.ts";

export type { CliConfig } from "./config.ts";

export { createMcpServer, PROTOCOL_VERSIONS } from "./mcp.ts";

export type { McpServer, McpServerOptions } from "./mcp.ts";

export { serveStdio } from "./stdio.ts";

export type { StdioOptions } from "./stdio.ts";

export interface CliIo {
  readonly stdout: (text: string) => void;
  readonly stderr: (text: string) => void;
  /** Opens standard input as lines. Called only by `outbound mcp`, so other commands exit when done. */
  readonly stdin?: (() => AsyncIterable<string> | Iterable<string>) | undefined;
  /** Replaces the adapter the environment would choose. Meant for tests. */
  readonly adapter?: Adapter | undefined;
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
  redact: { type: "boolean" },
  sequence: { type: "boolean" },
  settings: { type: "boolean" },
  since: { type: "string" },
  slack: { type: "boolean" },
  stats: { type: "boolean" },
  status: { type: "string" },
  subsequences: { type: "boolean" },
  to: { type: "string" },
} as const;

const serve = async (outbound: OutboundApi, io: CliIo): Promise<void> => {
  // Loaded on demand, so the other commands do not pay for the insights.
  const { insightTools } = await import("../insights/index.ts");

  const server = createMcpServer(outbound, {
    extra: insightTools(outbound),
    version: packageVersion(),
  });

  await serveStdio(server, { input: io.stdin?.() ?? [], write: io.stdout });
};

const print = (io: CliIo, value: Json, compact: boolean): void => {
  io.stdout(compact ? JSON.stringify(value) : JSON.stringify(value, null, 2));
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

  if (named && !command && !["mcp", "providers"].includes(name)) {
    throw new OutboundError(
      "Invalid",
      `Unknown command "${name}". Run "outbound help"`
    );
  }

  if (named) {
    checkFlags(
      name,
      command?.flags ?? [],
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
    const compact = values.compact === true;

    if (help !== undefined) {
      io.stdout(help);

      return 0;
    }

    if (name === "providers") {
      print(io, listProviders(), compact);

      return 0;
    }

    // `parse` refused an unknown command, so no command here is `mcp`.
    const command = name === undefined ? undefined : COMMANDS.get(name);

    const adapter =
      io.adapter ?? (await fromEnv({ provider: values.provider }));

    const plugins = await pluginsFor(values, command === undefined);
    const outbound = createOutbound({ adapter, plugins });

    if (command === undefined) {
      await serve(outbound, io);

      return 0;
    }

    const answer = await command.run(outbound, {
      flags: values,
      note: io.stderr,
      positionals: rest,
    });

    print(io, answer, compact);

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
