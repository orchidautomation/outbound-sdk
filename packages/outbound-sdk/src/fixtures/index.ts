// outbound-sdk/fixtures: records real responses to disk and replays them,
// with personal data scrubbed, for tests and demos. Files are written where
// you say and nowhere else.
//
// List it last (innermost) when recording, so what is saved is the vendor's
// answer and not another plugin's view of it.

import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

import { evidenceSchema } from "../internal/entities.ts";
import { OutboundError } from "../internal/errors.ts";
import { field, objects, parseJson, toJson } from "../internal/json.ts";
import type {
  Operation,
  OperationOutput,
  OutboundRecord,
} from "../internal/outbound/operations.ts";
import type { OutboundPlugin } from "../internal/outbound/plugins.ts";
import { stableId } from "../internal/sha256.ts";
import { createScrubber } from "./scrub.ts";

export { createScrubber } from "./scrub.ts";

export type { Scrubber } from "./scrub.ts";

export interface FixturesOptions {
  /** The folder to write to and read from. */
  readonly dir: string;
  /**
   * `record` calls the vendor and saves the answer. `replay` answers from
   * disk and never calls the vendor. `auto` replays when a file exists and
   * records otherwise. Defaults to `auto`.
   */
  readonly mode?: "auto" | "record" | "replay" | undefined;
  /** Replace personal data with placeholders before saving. Defaults to `true`. */
  readonly scrub?: boolean | undefined;
}

/** The file one operation is saved to. */
export const fixtureFile = (
  dir: string,
  provider: string,
  operation: Operation
): string =>
  path.join(
    dir,
    `${provider}.${operation.kind}.${stableId(JSON.stringify(operation)).slice(0, 12)}.json`
  );

const load = async (file: string): Promise<OperationOutput | undefined> => {
  let source: string;

  try {
    source = await readFile(file, "utf-8");
  } catch {
    return undefined;
  }

  const parsed = parseJson(source);
  const evidence = evidenceSchema.safeParse(field(parsed, "evidence"));

  if (parsed === undefined || !evidence.success) {
    throw new OutboundError(
      "Invalid",
      `The fixture ${file} is not a recorded operation`
    );
  }

  return {
    evidence: evidence.data,
    // SAFETY: written by this plugin from an OperationOutput; the wrapper re-validates every record against its schema.
    items: objects(field(parsed, "items")) as OutboundRecord[],
    next: field(parsed, "next") ?? undefined,
  };
};

/** Records operations to disk and replays them. */
export const fixtures = (options: FixturesOptions): OutboundPlugin => {
  const mode = options.mode ?? "auto";
  const scrubber = createScrubber();

  return {
    name: "fixtures",
    wrap: async (operation, next, info) => {
      const file = fixtureFile(options.dir, info.provider, operation);
      const saved = mode === "record" ? undefined : await load(file);

      if (saved !== undefined) {
        return saved;
      }

      if (mode === "replay") {
        throw new OutboundError(
          "NotFound",
          `No fixture was recorded for ${operation.kind} (${path.basename(file)})`,
          { provider: info.provider }
        );
      }

      const output = await next(operation);

      const kept: OperationOutput =
        options.scrub === false
          ? output
          : {
              ...output,
              items: output.items.map((record) => scrubber.record(record)),
            };

      await mkdir(options.dir, { recursive: true });
      await writeFile(file, `${JSON.stringify(toJson(kept), null, 2)}\n`);

      return kept;
    },
  };
};
