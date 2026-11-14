// The plugins a CLI command runs with: those a config file lists, and those
// the flags ask for. `outbound mcp` hands records to a model, so it masks
// personal fields unless told not to.

import path from "node:path";
import { pathToFileURL } from "node:url";

import { OutboundError } from "../internal/errors.ts";
import type { OutboundPlugin } from "../internal/outbound/plugins.ts";

/** What a file passed to `--config` exports as its default. */
export interface CliConfig {
  /** Plugins for the instance, outermost first, as in `createOutbound`. */
  readonly plugins?: readonly OutboundPlugin[] | undefined;
}

/** Returns the config unchanged. It exists so an editor can check its shape. */
export const defineConfig = (config: CliConfig): CliConfig => config;

export interface PluginFlags {
  readonly config?: string | undefined;
  readonly redact?: boolean | undefined;
  readonly "no-redact"?: boolean | undefined;
  readonly "max-requests"?: string | undefined;
  readonly cache?: string | undefined;
}

const isPlugin = (value: unknown): value is OutboundPlugin =>
  typeof value === "object" &&
  value !== null &&
  "name" in value &&
  typeof value.name === "string";

interface ConfigModule {
  readonly default: { readonly plugins?: unknown };
}

const isConfigModule = (value: unknown): value is ConfigModule =>
  typeof value === "object" &&
  value !== null &&
  "default" in value &&
  typeof value.default === "object" &&
  value.default !== null;

const isPluginList = (value: unknown): value is readonly OutboundPlugin[] =>
  Array.isArray(value) && value.every(isPlugin);

const loadConfig = async (file: string): Promise<readonly OutboundPlugin[]> => {
  let loaded: unknown;

  try {
    loaded = await import(pathToFileURL(path.resolve(file)).href);
  } catch (error) {
    throw new OutboundError(
      "Invalid",
      `Could not load the config file ${file}: ${error instanceof Error ? error.message : String(error)}`,
      { cause: error }
    );
  }

  if (!isConfigModule(loaded)) {
    throw new OutboundError(
      "Invalid",
      `The config file ${file} has no default export. Export defineConfig({ plugins: [...] })`
    );
  }

  const plugins = loaded.default.plugins ?? [];

  if (!isPluginList(plugins)) {
    throw new OutboundError(
      "Invalid",
      `The config file ${file} must export plugins as a list of plugins, such as [redact(), cache({ ttl: 300 })]`
    );
  }

  return plugins;
};

const positiveInteger = (flag: string, value: string): number => {
  const parsed = Number(value);

  if (!Number.isInteger(parsed) || parsed < 1) {
    throw new OutboundError(
      "Invalid",
      `--${flag} takes a positive whole number, not "${value}"`
    );
  }

  return parsed;
};

const wantsRedact = (
  flags: PluginFlags,
  fromConfig: boolean,
  mcp: boolean
): boolean => {
  if (flags["no-redact"] === true) {
    if (flags.redact === true) {
      throw new OutboundError(
        "Invalid",
        "--redact and --no-redact cannot both be set"
      );
    }

    if (fromConfig) {
      throw new OutboundError(
        "Invalid",
        "--no-redact conflicts with redact() in the config file. Remove one of them"
      );
    }

    return false;
  }

  // A redact() in the config file wins, with its own options.
  return !fromConfig && (flags.redact === true || mcp);
};

/**
 * The plugins for one command, outermost first: redact, then the config
 * file's plugins, then cache, then budget, next to the request engine.
 * `mcp` turns redact on unless `--no-redact` is set.
 */
export const pluginsFor = async (
  flags: PluginFlags,
  mcp: boolean
): Promise<OutboundPlugin[]> => {
  const configured =
    flags.config === undefined ? [] : await loadConfig(flags.config);

  const fromConfig = configured.some((plugin) => plugin.name === "redact");
  const plugins: OutboundPlugin[] = [];

  // Each plugin is loaded only when asked for, so other commands do not pay for it.
  if (wantsRedact(flags, fromConfig, mcp)) {
    const { redact } = await import("../redact/index.ts");
    plugins.push(redact());
  }

  plugins.push(...configured);

  if (flags.cache !== undefined) {
    const ttl = positiveInteger("cache", flags.cache);
    const { cache } = await import("../cache/index.ts");
    plugins.push(cache({ ttl }));
  }

  if (flags["max-requests"] !== undefined) {
    const maxRequests = positiveInteger("max-requests", flags["max-requests"]);
    const { budget } = await import("../budget/index.ts");
    // A run is reset before each MCP tool call, so this caps one tool call.
    // Outside the MCP server a command is one run.
    plugins.push(budget({ maxRequests, per: "run" }));
  }

  return plugins;
};
