import { OutboundError } from "outbound-sdk";
import type { OutboundPlugin } from "outbound-sdk";

/** One line of the log: which read ran, what it returned, how long it took. */
export interface ReadLogEntry {
  readonly kind: string;
  readonly records: number;
  /** `null` when the read failed: there was no answer to grade. */
  readonly evidence: string | null;
  readonly ms: number;
  /** The `OutboundError` code, or `null` when the read succeeded. */
  readonly error: string | null;
}

/** What the plugin adds to the instance, under one namespace. */
export interface ReadLogExtension {
  readonly readLog: {
    /** Entries handed to the sink. */
    readonly count: () => number;
    /** Entries the sink threw on or rejected. */
    readonly failed: () => number;
  };
}

/**
 * Hands every read to a sink the caller supplies. The plugin stores nothing
 * itself, and a sink that throws or rejects never fails the read.
 */
export const readLog = (options: {
  readonly sink: (entry: ReadLogEntry) => void | Promise<void>;
}): OutboundPlugin<ReadLogExtension> => {
  // State lives in the factory's closure, so scoped instances share it.
  let count = 0;
  let failed = 0;

  const fail = (): void => {
    failed += 1;
  };

  // Fire and forget: a broken sink is counted, never thrown to the reader.
  const send = (entry: ReadLogEntry): void => {
    count += 1;

    try {
      Promise.resolve(options.sink(entry)).catch(fail);
    } catch {
      fail();
    }
  };

  return {
    extend: () => ({
      readLog: { count: () => count, failed: () => failed },
    }),
    name: "read-log",
    wrap: async (operation, next) => {
      const started = Date.now();

      try {
        const output = await next(operation);

        send({
          error: null,
          evidence: output.evidence,
          kind: operation.kind,
          ms: Date.now() - started,
          records: output.items.length,
        });

        return output;
      } catch (error) {
        send({
          error: error instanceof OutboundError ? error.code : "unknown",
          evidence: null,
          kind: operation.kind,
          ms: Date.now() - started,
          records: 0,
        });

        throw error;
      }
    },
  };
};
