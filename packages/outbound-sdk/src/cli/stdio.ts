// Runs an MCP server over standard input and output, which is how an MCP
// client talks to a command it starts.

import process from "node:process";
import { createInterface } from "node:readline";

import type { McpServer } from "./mcp.ts";

export interface StdioOptions {
  /** Lines to answer. Defaults to standard input. */
  readonly input?: AsyncIterable<string> | Iterable<string> | undefined;
  /** Receives each response line. Defaults to standard output. */
  readonly write?: ((line: string) => void) | undefined;
}

/** Answers one JSON-RPC message per line, in order, until the input ends. */
export const serveStdio = async (
  server: McpServer,
  options: StdioOptions = {}
): Promise<void> => {
  const input = options.input ?? createInterface({ input: process.stdin });

  const write =
    options.write ??
    ((line: string) => {
      process.stdout.write(`${line}\n`);
    });

  for await (const line of input) {
    const response = await server.handleLine(line);

    if (response !== undefined) {
      write(response);
    }
  }
};
