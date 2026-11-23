// outbound-sdk/cli: the `outbound` command and the local MCP server.

import type { Adapter } from "../internal/adapter.ts";
import { OutboundError } from "../internal/errors.ts";
import { field } from "../internal/json.ts";
import { createOutbound } from "../internal/outbound/create.ts";
import type { OutboundOptions } from "../internal/outbound/outbound.ts";
import { fromEnv } from "../loader/index.ts";
import { parse } from "./args.ts";
import { COMMANDS, listProviders } from "./commands.ts";
import { insightToolCaps, setupFor } from "./config.ts";
import { requestCounter, valueOf, Answer } from "./envelope.ts";
import type { Printed, RunFacts } from "./envelope.ts";
import { printAnswer, printFailure, printLine } from "./output.ts";
import { throttleMonitor } from "./progress.ts";
import { namedTools, serve } from "./serve.ts";
import { runNpm, runSelf } from "./update.ts";

export { defineConfig } from "./config.ts";

export type { CliConfig } from "./config.ts";

export { createMcpServer, PROTOCOL_VERSIONS } from "./mcp.ts";

export { OUTPUT_SCHEMA } from "./mcp-answers.ts";

export type { McpServer, McpServerOptions } from "./mcp.ts";

export { serveStdio } from "./stdio.ts";

export { DEFAULT_TIME_BUDGET_MS, toolCallScope } from "./tool-call.ts";

export type { ToolCallScope } from "./tool-call.ts";

export { describeWait, throttleMonitor } from "./progress.ts";

export type { ThrottleMonitor, ThrottleTotal } from "./progress.ts";

export type { NpmRunner } from "./update.ts";

export type { StdioOptions } from "./stdio.ts";

export interface CliIo {
  readonly stdout: (text: string) => void;
  readonly stderr: (text: string) => void;
  /** Opens standard input as lines. Called only by `outbound mcp`, so other commands exit when done. */
  readonly stdin?: (() => AsyncIterable<string> | Iterable<string>) | undefined;
  /** Replaces the adapter the environment would choose. Meant for tests. */
  readonly adapter?: Adapter | undefined;
  /** Replaces the `fetch` vendor requests are sent with. Meant for tests. */
  readonly fetch?: OutboundOptions["fetch"];
  /** Replaces the clock and timers rate limit waits use. Meant for tests. */
  readonly runtime?: OutboundOptions["runtime"];
  /** Runs npm for `outbound update` and resolves to its output. Meant for tests. */
  readonly npm?: ((args: readonly string[]) => Promise<string>) | undefined;
  /** Waits between `outbound update` install retries. Meant for tests. */
  readonly sleep?: ((ms: number) => Promise<void>) | undefined;
}

/** The exit code of a command that printed its answer. */
const exitCode = (name: string | undefined, answer: Printed): number => {
  // A list `--limit` stopped while more records exist exits 3, so a
  // script cannot take a cut-off load for a whole one.
  if (answer instanceof Answer && answer.walked.truncated === true) {
    return 3;
  }

  // A tool never throws: its failure is a result, printed like any other.
  // The exit code still says the command did not get an answer: 2 when it
  // was given no input to run on, 1 when it ran and failed.
  const printed = valueOf(answer);

  if (name !== "tool" || field(printed, "ok") !== false) {
    return 0;
  }

  return field(field(printed, "error"), "code") === "InputRequired" ? 2 : 1;
};

/** Runs the CLI. Returns the process exit code. */
export const run = async (
  argv: readonly string[],
  io: CliIo
): Promise<number> => {
  const counter = requestCounter();
  // A wait on a rate limit goes to stderr, so a slow read never looks hung.
  const monitor = throttleMonitor(io.runtime?.now ?? Date.now, io.stderr);
  let provider: string | null = null;

  const facts = (): RunFacts => ({
    provider,
    requests: counter.sent(),
    throttledMs: monitor.total().ms,
  });

  let named: string | undefined;

  try {
    const { help, name, rest, values } = parse(argv);
    named = name;

    if (await runSelf(name, values, io.npm ?? runNpm, io.stdout, io.sleep)) {
      return 0;
    }

    if (help !== undefined) {
      io.stdout(help);

      return 0;
    }

    if (name === "providers") {
      printAnswer(io.stdout, listProviders(), values, facts());

      return 0;
    }

    // `parse` refused an unknown command, so no command here is `mcp`.
    const command = name === undefined ? undefined : COMMANDS.get(name);

    const { leadFields, plugins, rateLimitStore } = await setupFor(
      values,
      command === undefined,
      io.stderr
    );

    const adapter =
      io.adapter ?? (await fromEnv({ leadFields, provider: values.provider }));

    // Innermost, so it counts each request the engine sends, cache hits not.
    if (command !== undefined) {
      plugins.push(counter);
    }

    const outbound = createOutbound({
      adapter,
      fetch: io.fetch,
      hooks: monitor.hooks,
      plugins,
      rateLimitStore,
      runtime: io.runtime,
    });

    ({ provider } = outbound);

    if (command === undefined) {
      // The same instance without redact, to tell which tools redact left out.
      const unmasked = plugins.some((plugin) => plugin.name === "redact")
        ? createOutbound({
            adapter,
            plugins: plugins.filter((plugin) => plugin.name !== "redact"),
          })
        : undefined;

      await serve(
        outbound,
        { ...io, throttled: monitor.total, timeBudget: values["time-budget"] },
        unmasked,
        namedTools(values.tools),
        // A tool call may spend what --max-requests allows, which replaces an insight's default cap.
        insightToolCaps(values, true)
      );

      return 0;
    }

    const answer = await command.run(outbound, {
      emit: (record) => printLine(io.stdout, record, values),
      flags: values,
      note: io.stderr,
      positionals: rest,
    });

    printAnswer(io.stdout, answer, values, facts());

    return exitCode(name, answer);
  } catch (error) {
    const code = OutboundError.is(error) ? error.code : "Error";
    const message = error instanceof Error ? error.message : String(error);
    const partial = OutboundError.is(error) ? error.partial : undefined;
    const cursor = partial === undefined ? undefined : (partial.cursor ?? null);

    printFailure(
      io.stdout,
      { argv, name: named },
      { code, cursor, message },
      facts()
    );
    io.stderr(`${code}: ${message}`);

    return 1;
  }
};
