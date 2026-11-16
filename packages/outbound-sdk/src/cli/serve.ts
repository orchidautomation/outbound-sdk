// `outbound mcp`: the tools it offers, `--tools` among them, served on stdio.

import { OutboundError } from "../internal/errors.ts";
import type { OutboundApi } from "../internal/outbound/api.ts";
import { createTools, TOOL_NAMES } from "../tools/index.ts";
import { createMcpServer } from "./mcp.ts";
import type { ThrottleTotal } from "./progress.ts";
import { serveStdio } from "./stdio.ts";
import { didYouMean } from "./suggest.ts";
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

/** What `serve` reads messages from and writes answers to. */
export interface ServeIo {
  readonly stdin?: (() => AsyncIterable<string> | Iterable<string>) | undefined;
  readonly stdout: (text: string) => void;
  /** How long the server has waited on rate limits, for the note on a slow tool call. */
  readonly throttled?: (() => ThrottleTotal) | undefined;
}

/**
 * Serves MCP on stdio. `unmasked` is the same instance without redact, to
 * tell which tools redact left out; `wanted` is what `--tools` names.
 */
export const serve = async (
  outbound: OutboundApi,
  io: ServeIo,
  unmasked: OutboundApi | undefined,
  wanted: ReadonlySet<string> | undefined
): Promise<void> => {
  // Loaded on demand, so the other commands do not pay for the insights.
  const { insightTools } = await import("../insights/index.ts");

  const offered = (instance: OutboundApi) =>
    createTools(instance, { extra: insightTools(instance) }).map(
      (tool) => tool.name
    );

  // A tool offered without redact but not with it was left out by redact.
  const here = offered(outbound);

  const masked = (unmasked === undefined ? [] : offered(unmasked)).filter(
    (name) => !here.includes(name)
  );

  const known = [...here, ...masked];

  for (const name of wanted ?? []) {
    if (!known.includes(name)) {
      throw new OutboundError(
        "Invalid",
        `--tools: "${name}" is not a tool this server can offer.${didYouMean(name, known)} Run "outbound tools" to list them`
      );
    }
  }

  const keeps = (name: string): boolean =>
    wanted === undefined || wanted.has(name);

  const leftOut = Object.fromEntries(
    masked
      .filter(keeps)
      .map((name) => [
        name,
        `${name} is left out while the redact plugin is on: it needs what redact masks. Start the server with --no-redact to offer it; personal fields are then not masked.`,
      ])
  );

  const server = createMcpServer(outbound, {
    // Given the allowlist, so no insight's hint names an insight left out.
    extra: insightTools(outbound, {
      only: wanted === undefined ? undefined : [...wanted],
    }),
    leftOut,
    only: TOOL_NAMES.filter(keeps),
    throttled: io.throttled,
    version: packageVersion(),
  });

  await serveStdio(server, { input: io.stdin?.() ?? [], write: io.stdout });
};
