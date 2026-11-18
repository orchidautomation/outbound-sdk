// What a case reads through: the MCP server, the CLI and the SDK, offline
// over fixtures with a virtual clock, or live with the keys in the
// environment. Every surface spends from one request budget per run.

import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";

import { run } from "../packages/outbound-sdk/src/cli/index.ts";
import { createOutbound } from "../packages/outbound-sdk/src/index.ts";
import type {
  Adapter,
  Outbound,
  OutboundOptions,
  OutboundPlugin,
} from "../packages/outbound-sdk/src/index.ts";
import { fromEnv } from "../packages/outbound-sdk/src/loader/index.ts";
import { fixtureHandler } from "../packages/outbound-sdk/test/helpers/adapter-suite.ts";
import { createFetch } from "../packages/outbound-sdk/test/helpers/http.ts";
import {
  KEY as HEYREACH_KEY,
  suite as heyreachSuite,
} from "../packages/outbound-sdk/test/heyreach/suite.ts";
import {
  KEY as INSTANTLY_KEY,
  suite as instantlySuite,
} from "../packages/outbound-sdk/test/instantly/suite.ts";
import { virtualClock } from "./clock.ts";
import type { VirtualClock } from "./clock.ts";
import { at, num, parsed } from "./json.ts";
import { session } from "./session.ts";
import type { Budget, Session } from "./session.ts";
import { child, inProcess } from "./transport.ts";
import type { Transport } from "./transport.ts";

export const BIN = fileURLToPath(
  new URL("../packages/outbound-sdk/src/cli/bin.ts", import.meta.url)
);

/** The default server: `outbound mcp --provider all`, every other flag at its default. */
export const DEFAULT_FLAGS = ["--provider", "all"] as const;

/** The fixed "now" of an offline run: a few days after the fixtures' replies. */
export const OFFLINE_NOW = Date.UTC(2026, 10, 18, 12);

/** Offline only: each tool call's time budget, in virtual seconds. */
export const OFFLINE_TIME_BUDGET_S = 3600;

export class BudgetSpentError extends Error {
  constructor(limit: number) {
    super(`the run's request budget of ${limit} is spent`);
    this.name = "BudgetSpentError";
  }
}

export interface CliOutcome {
  readonly code: number;
  readonly stdout: string;
  readonly stderr: string;
  /** The printed envelope, when stdout is one JSON document. */
  readonly json: unknown;
}

export interface Context {
  readonly live: boolean;
  /** A server started with these flags; the same flags share one session. */
  readonly mcp: (flags?: readonly string[]) => Session;
  readonly cli: (
    argv: readonly string[],
    env?: Readonly<Record<string, string>>
  ) => Promise<CliOutcome>;
  /** An SDK instance over every provider whose key is set. */
  readonly sdk: (plugins?: readonly OutboundPlugin[]) => Promise<Outbound>;
  /** What `sdk` builds its instance from, for a case that needs a plugin's own types. */
  readonly sdkOptions: () => Promise<SdkOptions>;
  readonly settle: <Value>(promise: Promise<Value>) => Promise<Value>;
  readonly now: () => number;
  readonly spent: () => number;
  readonly budget: Budget;
  /** Offline: fixture requests no route answered. */
  readonly unrouted: readonly string[];
  readonly close: () => Promise<void>;
}

export interface SdkOptions {
  readonly adapter: Adapter;
  readonly fetch?: typeof fetch | undefined;
  readonly runtime?: OutboundOptions["runtime"];
}

export interface ContextOptions {
  readonly live: boolean;
  /** The most vendor requests the whole run may make. */
  readonly maxRequests: number;
  /** Live only: the CLI entry to run, so a run can read another worktree. Defaults to this checkout's. */
  readonly bin?: string | undefined;
}

const PROVIDER_KEYS = [
  "INSTANTLY_API_KEY",
  "HEYREACH_API_KEY",
  "SMARTLEAD_API_KEY",
  "EMAILBISON_API_KEY",
  "OUTBOUND_SDK_PROVIDER",
  "OUTBOUND_REDACT_KEY",
];

type Env = Readonly<Record<string, string | undefined>>;

/** Sets each variable, unsetting those given as undefined, and returns what they were. */
const setEnv = (env: Env): Env => {
  const saved = Object.fromEntries(
    Object.keys(env).map((key) => [key, process.env[key]])
  );

  for (const [key, value] of Object.entries(env)) {
    if (value === undefined) {
      Reflect.deleteProperty(process.env, key);
    } else {
      process.env[key] = value;
    }
  }

  return saved;
};

const withEnv = async <Value>(
  env: Env,
  work: () => Promise<Value>
): Promise<Value> => {
  const saved = setEnv(env);

  try {
    return await work();
  } finally {
    setEnv(saved);
  }
};

const childCli = (
  bin: string,
  argv: readonly string[],
  env: Env
): Promise<CliOutcome> =>
  new Promise((resolve) => {
    const proc = spawn(process.execPath, [bin, ...argv], {
      env: { ...process.env, ...env },
      stdio: ["ignore", "pipe", "pipe"],
    });

    const out: Buffer[] = [];
    const err: Buffer[] = [];
    proc.stdout.on("data", (chunk: Buffer) => out.push(chunk));
    proc.stderr.on("data", (chunk: Buffer) => err.push(chunk));
    proc.on("close", (code) => {
      const stdout = Buffer.concat(out).toString("utf-8");
      resolve({
        code: code ?? 1,
        json: parsed(stdout),
        stderr: Buffer.concat(err).toString("utf-8"),
        stdout,
      });
    });
  });

const runBudget = (max: number): Budget & { readonly spent: () => number } => {
  let spent = 0;

  return {
    check: () => {
      if (spent >= max) {
        throw new BudgetSpentError(max);
      }
    },
    spend: (requests) => {
      spent += requests ?? 0;
    },
    spent: () => spent,
  };
};

interface Offline {
  readonly clock: VirtualClock;
  readonly fetch: typeof fetch;
  readonly unrouted: readonly string[];
  readonly restore: () => void;
}

/** Offline, the fixtures' tools are the only ones, and every insight's window ends at the fixed now. */
const goOffline = (): Offline => {
  const unrouted: string[] = [];
  const clock = virtualClock(OFFLINE_NOW);
  const realNow = Date.now;

  const saved = setEnv({
    ...Object.fromEntries(PROVIDER_KEYS.map((key) => [key, undefined])),
    HEYREACH_API_KEY: HEYREACH_KEY,
    INSTANTLY_API_KEY: INSTANTLY_KEY,
  });

  Date.now = clock.now;

  return {
    clock,
    fetch: createFetch(
      fixtureHandler([instantlySuite, heyreachSuite], unrouted)
    ).fetch,
    restore: () => {
      Date.now = realNow;
      setEnv(saved);
    },
    unrouted,
  };
};

const inProcessCli = async (
  offline: Offline,
  argv: readonly string[],
  env: Env
): Promise<CliOutcome> =>
  await withEnv(env, async () => {
    const out: string[] = [];
    const err: string[] = [];

    const code = await offline.clock.settle(
      run(argv, {
        fetch: offline.fetch,
        runtime: offline.clock,
        stderr: (line) => err.push(line),
        stdout: (line) => out.push(line),
      })
    );

    const stdout = out.join("\n");

    return { code, json: parsed(stdout), stderr: err.join("\n"), stdout };
  });

export const createContext = (options: ContextOptions): Context => {
  const budget = runBudget(options.maxRequests);
  const sessions = new Map<string, Session>();
  const offline = options.live ? undefined : goOffline();
  const bin = options.bin ?? BIN;

  const settle =
    offline === undefined
      ? <Value>(promise: Promise<Value>) => promise
      : offline.clock.settle;

  const now = offline === undefined ? () => Date.now() : offline.clock.now;

  const sdkOptions = async (): Promise<SdkOptions> => {
    const adapter = await fromEnv({ provider: "all" });

    return offline === undefined
      ? { adapter }
      : { adapter, fetch: offline.fetch, runtime: offline.clock };
  };

  // Offline time is virtual, so a long budget only lets the fixtures be read in full; case 19 sets its own.
  const transportFor = (flags: readonly string[]): Transport =>
    offline === undefined
      ? child([process.execPath, bin, "mcp", ...flags])
      : inProcess(
          flags.includes("--time-budget")
            ? flags
            : [...flags, "--time-budget", String(OFFLINE_TIME_BUDGET_S)],
          {
            fetch: offline.fetch,
            now,
            runtime: offline.clock,
            settle,
          }
        );

  return {
    budget,
    cli: async (argv, env = {}) => {
      budget.check();

      const outcome =
        offline === undefined
          ? await childCli(bin, argv, env)
          : await inProcessCli(offline, argv, env);

      budget.spend(num(at(outcome.json, "meta", "requests")));

      return outcome;
    },
    close: async () => {
      await Promise.all([...sessions.values()].map((open) => open.close()));
      offline?.restore();
    },
    live: options.live,
    mcp: (flags = DEFAULT_FLAGS) => {
      const key = flags.join(" ");
      const open = sessions.get(key) ?? session(transportFor(flags), budget);
      sessions.set(key, open);

      return open;
    },
    now,
    sdk: async (plugins = []) =>
      createOutbound({ ...(await sdkOptions()), plugins: [...plugins] }),
    sdkOptions,
    settle,
    spent: budget.spent,
    unrouted: offline?.unrouted ?? [],
  };
};
