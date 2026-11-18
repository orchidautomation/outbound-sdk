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

  return {
    close: async () => {
      queue.end();
      await io.settle(served);
    },
    now: io.now,
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

  const exited = new Promise<void>((resolve) => {
    proc.on("exit", () => {
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
    onLine: (listener) => {
      listeners.push(listener);
    },
    send: (message) => {
      proc.stdin.write(`${JSON.stringify(message)}\n`);
    },
    settle: (promise) => promise,
  };
};
