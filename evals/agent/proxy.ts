// A pass-through MCP server for the agent runner: it starts the real
// `outbound mcp`, relays stdio both ways, and appends one line per tool
// call to EVAL_CALL_LOG with the tool's name, timing, error code, vendor
// requests and completeness. No argument or result content is logged.
//
//   node evals/agent/proxy.ts <command that starts the server...>

import { spawn } from "node:child_process";
import { appendFileSync } from "node:fs";
import { createInterface } from "node:readline";

import { at, bool, num, parsed, text } from "../json.ts";

export interface LoggedCall {
  readonly name: string;
  readonly listed: boolean;
  readonly ms: number;
  readonly code: string | null;
  readonly requests: number | null;
  readonly complete: boolean | null;
}

/** What one tools/call answer says, without its content. */
export const callFacts = (
  answer: unknown
): Pick<LoggedCall, "code" | "complete" | "requests"> => {
  const structured = at(answer, "result", "structuredContent");
  const rpc = text(at(answer, "error", "message"));
  const failed = rpc !== null || at(answer, "result", "isError") === true;

  let code: string | null = null;

  if (rpc !== null) {
    code = "rpc";
  } else if (failed) {
    code = text(at(structured, "error", "code")) ?? "Error";
  }

  return {
    code,
    complete: bool(at(structured, "meta", "complete")),
    requests: num(at(structured, "meta", "requests")),
  };
};

const main = (): void => {
  const log = process.env.EVAL_CALL_LOG;
  const [file = "node", ...args] = process.argv.slice(2);
  const server = spawn(file, args, { stdio: ["pipe", "pipe", "inherit"] });

  const pending = new Map<
    number,
    { readonly name: string; readonly at: number }
  >();

  let listed = new Set<string>();

  createInterface({ input: process.stdin })
    .on("line", (line) => {
      const message = parsed(line);
      const id = num(at(message, "id"));

      if (id !== null && at(message, "method") === "tools/call") {
        pending.set(id, {
          at: Date.now(),
          name: text(at(message, "params", "name")) ?? "",
        });
      }

      server.stdin.write(`${line}\n`);
    })
    .on("close", () => {
      server.stdin.end();
    });

  createInterface({ input: server.stdout }).on("line", (line) => {
    process.stdout.write(`${line}\n`);
    const message = parsed(line);
    const tools = at(message, "result", "tools");

    if (Array.isArray(tools)) {
      listed = new Set(tools.map((tool) => text(at(tool, "name")) ?? ""));
    }

    const id = num(at(message, "id"));
    const call = id === null ? undefined : pending.get(id);

    if (call !== undefined && id !== null && log !== undefined) {
      pending.delete(id);

      const entry: LoggedCall = {
        ...callFacts(message),
        listed: listed.has(call.name),
        ms: Date.now() - call.at,
        name: call.name,
      };

      appendFileSync(log, `${JSON.stringify(entry)}\n`);
    }
  });

  server.on("exit", (code) => {
    process.exit(code ?? 0);
  });
};

if (import.meta.main) {
  main();
}
