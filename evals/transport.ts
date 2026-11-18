// One JSON-RPC line channel to an MCP server: the CLI's own server run in
// this process over fixtures (offline), or `outbound mcp` as a child process
// over stdio, the way an MCP client starts it (live).

import { spawn } from "node:child_process";
import { createInterface } from "node:readline";

import { run } from "../packages/outbound-sdk/src/cli/index.ts";
import type { CliIo } from "../packages/outbound-sdk/src/cli/index.ts";

export type JsonObject = Readonly<Record<string, unknown>>;

export interface Transport {
  readonly send: (message: JsonObject) => void;
  readonly onLine: (listener: (line: string) => void) => void;
  /** Called once when the server stops, with why, so pending requests can fail instead of hanging. */
  readonly onExit: (listener: (reason: string) => void) => void;
  readonly close: () => Promise<void>;
  /** Awaits a pending answer; offline it also fires the virtual clock's timers. */
  readonly settle: <Value>(promise: Promise<Value>) => Promise<Value>;
  readonly now: () => number;
}

interface LineQueue {
  readonly push: (line: string) => void;
  readonly end: () => void;
  readonly lines: () => AsyncIterable<string>;
}

const lineQueue = (): LineQueue => {
  const waiting: string[] = [];

  const state: { wake: (() => void) | undefined; ended: boolean } = {
    ended: false,
    wake: undefined,
  };

  const arrival = (): Promise<void> =>
    new Promise((resolve) => {
      state.wake = resolve;
    });

  const lines = async function* lines(): AsyncIterable<string> {
    while (true) {
      const next = waiting.shift();

      if (next !== undefined) {
        yield next;
      } else if (state.ended) {
        return;
      } else {
        await arrival();
      }
    }
  };

  return {
    end: () => {
      state.ended = true;
      state.wake?.();
    },
    lines,
    push: (line) => {
      waiting.push(line);
      state.wake?.();
    },
  };
};

export interface InProcessIo {
  readonly fetch: NonNullable<CliIo["fetch"]>;
  readonly runtime: NonNullable<CliIo["runtime"]>;
  readonly settle: Transport["settle"];
  readonly now: () => number;
}

export const inProcess = (
  argv: readonly string[],
  io: InProcessIo
): Transport => {
  const queue = lineQueue();
  const listeners: ((line: string) => void)[] = [];
  const exits: ((reason: string) => void)[] = [];

  const served = run(["mcp", ...argv], {
    fetch: io.fetch,
    runtime: io.runtime,
    stderr: () => {
      // Throttle notes; the eval reads the protocol only.
    },
    stdin: queue.lines,
    stdout: (line) => {
      for (const listener of listeners) {
        listener(line);
      }
    },
  });

  const ended = async (): Promise<string> => {
    try {
      return `the MCP server exited with code ${String(await served)}`;
    } catch (error) {
      return `the MCP server threw: ${String(error)}`;
    }
  };

  void ended().then((reason) => {
    for (const exit of exits) {
      exit(reason);
    }

    return reason;
  });

  return {
    close: async () => {
      queue.end();
      await io.settle(served);
    },
    now: io.now,
    onExit: (listener) => {
      exits.push(listener);
    },
    onLine: (listener) => {
      listeners.push(listener);
    },
    send: (message) => {
      queue.push(JSON.stringify(message));
    },
    settle: io.settle,
  };
};

const KILL_AFTER_MS = 10_000;

/** The longest a live answer may take: above any tool's time budget, so only a hung server reaches it. */
export const ANSWER_TIMEOUT_MS = 300_000;

/** Starts `command` (the server and its flags) as a child process, with this process's environment. */
export const child = (command: readonly string[]): Transport => {
  const [file = "node", ...args] = command;
  const proc = spawn(file, args, { stdio: ["pipe", "pipe", "ignore"] });
  const listeners: ((line: string) => void)[] = [];

  createInterface({ input: proc.stdout }).on("line", (line) => {
    for (const listener of listeners) {
      listener(line);
    }
  });

  const exits: ((reason: string) => void)[] = [];

  const exited = new Promise<void>((resolve) => {
    proc.on("exit", (code, signal) => {
      for (const exit of exits) {
        exit(`the MCP server exited with ${signal ?? `code ${String(code)}`}`);
      }

      resolve();
    });

    proc.on("error", (error) => {
      for (const exit of exits) {
        exit(`the MCP server could not start: ${error.message}`);
      }

      resolve();
    });
  });

  return {
    close: async () => {
      proc.stdin.end();
      const kill = setTimeout(() => proc.kill(), KILL_AFTER_MS);
      await exited;
      clearTimeout(kill);
    },
    now: () => Date.now(),
    onExit: (listener) => {
      exits.push(listener);
    },
    onLine: (listener) => {
      listeners.push(listener);
    },
    send: (message) => {
      if (proc.stdin.writable) {
        proc.stdin.write(`${JSON.stringify(message)}\n`);
      }
    },
    settle: async (promise) => {
      let timer: NodeJS.Timeout | undefined;

      const timeout = new Promise<never>((_resolve, reject) => {
        timer = setTimeout(() => {
          reject(
            new Error(
              `the MCP server gave no answer in ${ANSWER_TIMEOUT_MS / 1000} s`
            )
          );
        }, ANSWER_TIMEOUT_MS);
      });

      try {
        return await Promise.race([promise, timeout]);
      } finally {
        clearTimeout(timer);
      }
    },
  };
};
