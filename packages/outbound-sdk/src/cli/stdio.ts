// Runs an MCP server over standard input and output, which is how an MCP
// client talks to a command it starts.

import process from "node:process";
import { createInterface } from "node:readline";

import type { JsonObject } from "../internal/json.ts";
import type { McpServer } from "./mcp.ts";

export interface StdioOptions {
  /** Lines to answer. Defaults to standard input. */
  readonly input?: AsyncIterable<string> | Iterable<string> | undefined;
  /** Receives each response line. Defaults to standard output. */
  readonly write?: ((line: string) => void) | undefined;
}

/**
 * Answers one JSON-RPC message per line until the input ends and every
 * answer is written. A message is read while earlier ones are still being
 * answered, so ping and a cancellation reach the server during a long tool
 * call; an answer is written when it is ready, with the id it answers.
 */
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

  const notify = (message: JsonObject): void => {
    write(JSON.stringify(message));
  };

  // Answers in flight, by the order they were read. Each leaves once
  // written, so a long session does not keep every answer.
  const pending = new Map<number, Promise<void>>();
  const failures: unknown[] = [];

  const answer = async (line: string, index: number): Promise<void> => {
    try {
      const response = await server.handleLine(line, notify);

      if (response !== undefined) {
        write(response);
      }
    } catch (error) {
      failures.push(error);
    } finally {
      pending.delete(index);
    }
  };

  let read = 0;

  for await (const line of input) {
    pending.set(read, answer(line, read));
    read += 1;
  }

  await Promise.all(pending.values());

  if (failures.length > 0) {
    throw failures[0];
  }
};
