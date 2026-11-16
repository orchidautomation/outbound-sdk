// How the CLI prints an answer. Records lose `raw`, the vendor's own payload,
// unless `--raw` asks for it: for a reply it can carry the whole quoted
// thread as text and HTML, even when `--bodies` was not passed.

import { isJsonObject } from "../internal/json.ts";
import type { Json } from "../internal/json.ts";
import { envelope, failedEnvelope } from "./envelope.ts";
import type { Failure, Printed, RunFacts } from "./envelope.ts";

/** The CLI's own `--compact` and `--raw`. */
export interface PrintOptions {
  readonly compact?: boolean | undefined;
  readonly raw?: boolean | undefined;
}

// A record carries `ref` and `schemaVersion`. A vendor payload, such as what
// `native` prints, does not, so it is printed whole.
const isRecord = (value: Json): boolean =>
  isJsonObject(value) && "ref" in value && "schemaVersion" in value;

/** The answer with `raw` taken off every record in it, at any depth. */
export const withoutRaw = (value: Json): Json => {
  if (Array.isArray(value)) {
    return value.map(withoutRaw);
  }

  if (!isJsonObject(value)) {
    return value;
  }

  return Object.fromEntries(
    Object.entries(value)
      .filter(([key]) => !(key === "raw" && isRecord(value)))
      .map(([key, item]) => [key, withoutRaw(item)])
  );
};

/** Prints JSON as it is: indented, or on one line with `--compact`. */
export const printJson = (
  write: (text: string) => void,
  value: Json,
  options: PrintOptions
): void => {
  const shown = options.raw === true ? value : withoutRaw(value);

  write(
    options.compact === true
      ? JSON.stringify(shown)
      : JSON.stringify(shown, null, 2)
  );
};

/** Prints a command's answer in the envelope (see `envelope.ts`). */
export const printAnswer = (
  write: (text: string) => void,
  printed: Printed,
  options: PrintOptions,
  facts: RunFacts
): void => {
  printJson(write, envelope(printed, facts), options);
};

// Commands whose standard output is not JSON: the MCP server's protocol, and
// version and update. A failure there goes to standard error only.
const TEXT_COMMANDS: ReadonlySet<string> = new Set([
  "mcp",
  "update",
  "version",
]);

/**
 * Prints a command that failed in the envelope, so stdout keeps its shape.
 * Parsing may have failed first, so `--compact` is read from the arguments.
 */
export const printFailure = (
  write: (text: string) => void,
  run: { readonly argv: readonly string[]; readonly name: string | undefined },
  failure: Failure,
  facts: RunFacts
): void => {
  if (!TEXT_COMMANDS.has(run.name ?? "")) {
    printJson(write, failedEnvelope(failure, facts), {
      compact: run.argv.includes("--compact"),
    });
  }
};
