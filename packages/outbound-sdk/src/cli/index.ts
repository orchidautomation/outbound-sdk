// outbound-sdk/cli: the `outbound` command and the local MCP server.

import { parseArgs } from "node:util";

import type { Adapter } from "../internal/adapter.ts";
import { OutboundError } from "../internal/errors.ts";
import type { Json } from "../internal/json.ts";
import type { OutboundApi } from "../internal/outbound/api.ts";
import { createOutbound } from "../internal/outbound/create.ts";
import { fromEnv } from "../loader/index.ts";
import { COMMANDS, helpText, listProviders } from "./commands.ts";
import { createMcpServer } from "./mcp.ts";

export { createMcpServer, PROTOCOL_VERSIONS } from "./mcp.ts";

export type { McpServer, McpServerOptions } from "./mcp.ts";

export interface CliIo {
  readonly stdout: (text: string) => void;
  readonly stderr: (text: string) => void;
  /** Opens standard input as lines. Called only by `outbound mcp`, so other commands exit when done. */
  readonly stdin?: (() => AsyncIterable<string>) | undefined;
  /** Replaces the adapter the environment would choose. Meant for tests. */
  readonly adapter?: Adapter | undefined;
}

const OPTIONS = {
  bodies: { type: "boolean" },
  by: { type: "string" },
  campaign: { type: "string" },
  category: { type: "string" },
  compact: { type: "boolean" },
  from: { type: "string" },
  help: { short: "h", type: "boolean" },
  input: { type: "string" },
  limit: { type: "string" },
  provider: { type: "string" },
  sequence: { type: "boolean" },
  since: { type: "string" },
  stats: { type: "boolean" },
  status: { type: "string" },
  to: { type: "string" },
} as const;

const serve = async (outbound: OutboundApi, io: CliIo): Promise<void> => {
  const server = createMcpServer(outbound);

  for await (const line of io.stdin?.() ?? []) {
    const response = await server.handleLine(line);

    if (response !== undefined) {
      io.stdout(response);
    }
  }
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

    const outbound = createOutbound({ adapter });

    if (command === undefined) {
      await serve(outbound, io);

      return 0;
    }

    print(
      io,
      await command.run(outbound, { flags: values, positionals: rest }),
      compact
    );

    return 0;
  } catch (error) {
    const code = OutboundError.is(error) ? error.code : "Error";
    io.stderr(
      `${code}: ${error instanceof Error ? error.message : String(error)}`
    );

    return 1;
  }
};
