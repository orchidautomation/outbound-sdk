// `outbound mcp`: the tools it offers, `--tools` among them, served on stdio.

import { OutboundError } from "../internal/errors.ts";
import type { OutboundApi } from "../internal/outbound/api.ts";
import type { InsightToolCaps } from "./config.ts";
import { createMcpServer } from "./mcp.ts";
import type { McpServerOptions } from "./mcp.ts";
import { catalog } from "./offered.ts";
import type { ThrottleTotal } from "./progress.ts";
import { serveStdio } from "./stdio.ts";
import { didYouMean } from "./suggest.ts";
import { toolCallScope } from "./tool-call.ts";
import { packageVersion } from "./version.ts";

/** The tools `--tools` names, or `undefined` without it: every tool. */
export const namedTools = (
  given: string | undefined
): Set<string> | undefined => {
  if (given === undefined) {
    return undefined;
  }

  const names = given
    .split(",")
    .map((name) => name.trim())
    .filter((name) => name !== "");

  if (names.length === 0) {
    throw new OutboundError(
      "Invalid",
      "--tools takes tool names separated by commas, such as --tools campaign_overview,hot_leads"
    );
  }

  return new Set(names);
};

/** `--time-budget`, in whole seconds. */
const secondsFlag = (value: string): number => {
  const seconds = Number(value);

  if (!Number.isInteger(seconds) || seconds < 1) {
    throw new OutboundError(
      "Invalid",
      `--time-budget takes a positive whole number of seconds, not "${value}"`
    );
  }

  return seconds;
};

/** What `serve` reads messages from and writes answers to. */
export interface ServeIo {
  readonly stdin?: (() => AsyncIterable<string> | Iterable<string>) | undefined;
  readonly stdout: (text: string) => void;
  /** How long the server has waited on rate limits, for the note on a slow tool call. */
  readonly throttled?: (() => ThrottleTotal) | undefined;
  /** `--time-budget`: the seconds one tool call may take. */
  readonly timeBudget?: string | undefined;
  /** Replaces the clock and timers. Meant for tests. */
  readonly runtime?: McpServerOptions["runtime"];
}

/**
 * Serves MCP on stdio: the CLI's catalog, and every tool it leaves out named
 * with the reason. `unmasked` is the same instance without redact, to tell
 * which tools redact left out; `wanted` is what `--tools` names, and a name
 * the catalog leaves out is refused with its reason.
 */
export const serve = async (
  given: OutboundApi,
  io: ServeIo,
  unmasked: OutboundApi | undefined,
  wanted: ReadonlySet<string> | undefined,
  caps: InsightToolCaps
): Promise<void> => {
  const timeBudgetMs =
    io.timeBudget === undefined ? undefined : secondsFlag(io.timeBudget) * 1000;

  // Every tool is built on the scoped instance, so each call keeps to its time budget.
  const scope = toolCallScope();
  const outbound = scope.over(given);

  const { leftOut, offered, tools, turnOn } = await catalog(
    outbound,
    caps,
    unmasked,
    wanted
  );

  for (const name of wanted ?? []) {
    const why = leftOut[name];

    if (why !== undefined) {
      throw new OutboundError("Unsupported", `--tools: ${why}`, {
        provider: outbound.provider,
      });
    }

    if (!offered.includes(name)) {
      throw new OutboundError(
        "Invalid",
        `--tools: "${name}" is not a tool this server can offer.${didYouMean(name, [...offered, ...Object.keys(leftOut)])} Run "outbound tools" to list them`
      );
    }
  }

  const server = createMcpServer(outbound, {
    // The catalog's own tools, so the server offers what `outbound tools` lists.
    extra: tools,
    // Named in initialize, and a call to one answered with how to get it.
    leftOut: wanted === undefined ? turnOn : {},
    only: [],
    runtime: io.runtime,
    scope,
    throttled: io.throttled,
    timeBudgetMs,
    timeBudgetSetting: "--time-budget on outbound mcp",
    version: packageVersion(),
  });

  await serveStdio(server, { input: io.stdin?.() ?? [], write: io.stdout });
};
