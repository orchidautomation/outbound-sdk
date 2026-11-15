// outbound-sdk/cli: the `outbound` command and the local MCP server.

import { parseArgs } from "node:util";

import type { Adapter } from "../internal/adapter.ts";
import { OutboundError } from "../internal/errors.ts";
import { field } from "../internal/json.ts";
import type { Json } from "../internal/json.ts";
import type { OutboundApi } from "../internal/outbound/api.ts";
import { createOutbound } from "../internal/outbound/create.ts";
import { fromEnv } from "../loader/index.ts";
import { COMMANDS, helpText, listProviders } from "./commands.ts";
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

/** Runs the CLI. Returns the process exit code. */
export const run = async (
  argv: readonly string[],
  io: CliIo
): Promise<number> => {
  try {
    const { positionals, values } = parseArgs({
      allowPositionals: true,
      args: [...argv],
      options: OPTIONS,
    });

    const [name, ...rest] = positionals;
    const compact = values.compact === true;

    if (name === undefined || name === "help" || values.help === true) {
      io.stdout(helpText());

      return 0;
    }

    if (name === "providers") {
      print(io, listProviders(), compact);

      return 0;
    }

    const command = name === "mcp" ? undefined : COMMANDS.get(name);

    if (name !== "mcp" && command === undefined) {
      throw new OutboundError(
        "Invalid",
        `Unknown command "${name}". Run "outbound help"`
      );
    }

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
