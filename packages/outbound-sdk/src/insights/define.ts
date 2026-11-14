// What an insight is. An insight answers one question an operator asks by
// reading through the SDK and doing plain arithmetic on what comes back. It
// calls no model and stores nothing. One definition serves the typed method
// on the instance, the agent tool and the CLI command.

import type { ZodObject, ZodType } from "zod";

import type { CapabilityKey } from "../internal/capabilities.ts";
import type { Evidence, MetricRow } from "../internal/entities.ts";
import { OutboundError } from "../internal/errors.ts";
import { toJson, unknownKey } from "../internal/json.ts";
import type { Json } from "../internal/json.ts";
import type {
  ListAll,
  OutboundApi,
  PageResult,
  ResultMeta,
  StatsResult,
  WithMeta,
} from "../internal/outbound/api.ts";

export interface InsightMeta {
  /** `exact` only when every read behind the answer was exact. */
  readonly evidence: Evidence;
  /** Vendor requests the insight made. */
  readonly requests: number;
  /** `false` when a cap stopped a read early, so the answer covers part of the data. */
  readonly complete: boolean;
  /** What the reader should know before trusting the numbers. */
  readonly notes: readonly string[];
  readonly provider: string;
  /** When the insight was computed, ISO 8601 UTC. */
  readonly computedAt: string;
}

export interface InsightResult<Data> {
  readonly insight: string;
  readonly data: Data;
  readonly meta: InsightMeta;
}

/** What an insight reads through. Every helper records the read's cost and evidence. */
export interface InsightContext {
  readonly outbound: OutboundApi;
  /** The time the insight runs at, in milliseconds. Fixed in tests. */
  readonly now: number;
  /** Records a page's cost and returns its items. An unfinished page marks the answer incomplete. */
  readonly page: <Item>(page: PageResult<Item>) => readonly Item[];
  /**
   * Walks a listing to its end or its `max`, records the cost and returns the
   * records. When `max` cut it short the answer is marked incomplete; `cap`
   * names what was capped for the note, for example `50 campaigns`.
   */
  readonly all: <Item>(walk: ListAll<Item>, cap?: string) => Promise<Item[]>;
  /** Records one lookup's cost and returns the record. */
  readonly one: <Item>(item: WithMeta<Item>) => Item;
  /** Records a stats read's cost and returns its rows. */
  readonly rows: (stats: StatsResult) => readonly MetricRow[];
  /** Adds a note to the answer. The same note is kept once. */
  readonly note: (text: string) => void;
  /** Marks the answer as covering part of the data, with the reason as a note. */
  readonly partial: (reason: string) => void;
}

export interface RunOptions {
  /** Replaces the clock. Meant for tests. */
  readonly now?: number | undefined;
}

/** What every insight has in common, whatever its input and its answer. */
export interface InsightEntry {
  /** The method name on `outbound.insights`, camelCase. */
  readonly key: string;
  /** The tool and CLI name, snake_case. */
  readonly name: string;
  /** Self-contained: a model needs no system prompt to use it. Says what it costs. */
  readonly description: string;
  /** A `z.object()`. Every field has a description and, where it can, a default. */
  readonly inputSchema: ZodObject;
  /** Capabilities the adapter must have. Checked before any request. */
  readonly needs: readonly CapabilityKey[];
  /** What to ask next, for an agent. */
  readonly next: string;
  /** Checks the input and the capabilities, then runs the insight. */
  readonly execute: (
    outbound: OutboundApi,
    input?: Json,
    options?: RunOptions
  ) => Promise<InsightResult<Json>>;
}

/**
 * `Input` is what `run` receives, with every default applied. `Given` is what
 * a caller writes, where a field with a default may be left out.
 */
export interface InsightSpec<Key extends string, Input, Data, Given = Input> {
  readonly key: Key;
  readonly name: string;
  readonly description: string;
  readonly inputSchema: ZodObject & ZodType<Input, Given>;
  readonly needs: readonly CapabilityKey[];
  /**
   * Capabilities this input needs on top of `needs`, when what is read
   * depends on the input. Checked before any request, like `needs`.
   */
  readonly needsFor?: ((input: Input) => readonly CapabilityKey[]) | undefined;
  readonly next: string;
  readonly run: (context: InsightContext, input: Input) => Promise<Data>;
}

export interface InsightDefinition<
  Key extends string = string,
  Input = never,
  Data = Json,
  Given = Input,
> extends InsightEntry {
  readonly key: Key;
  readonly inputSchema: ZodObject & ZodType<Input, Given>;
  readonly run: (context: InsightContext, input: Input) => Promise<Data>;
  /** Never set. It carries the caller's input type to `outbound.insights`. */
  readonly given?: Given;
}

const RANK: Readonly<Record<Evidence, number>> = {
  derived: 2,
  exact: 0,
  sampled: 1,
};

interface Tracker {
  readonly context: InsightContext;
  readonly meta: () => Omit<InsightMeta, "computedAt" | "provider">;
}

const track = (outbound: OutboundApi, now: number): Tracker => {
  const notes: string[] = [];
  let requests = 0;
  let evidence: Evidence = "exact";
  let complete = true;

  const seen = (meta: ResultMeta | undefined): void => {
    if (meta === undefined) {
      return;
    }

    requests += meta.requests;
    evidence = RANK[meta.evidence] > RANK[evidence] ? meta.evidence : evidence;
  };

  const note = (text: string): void => {
    if (!notes.includes(text)) {
      notes.push(text);
    }
  };

  const partial = (reason: string): void => {
    complete = false;
    note(reason);
  };

  return {
    context: {
      all: async (walk, cap) => {
        const items = await walk.toArray();
        seen(walk.meta);

        if (walk.truncated) {
          partial(
            cap === undefined
              ? "A listing was cut off at its cap; more records exist."
              : `Stopped at ${cap}; more exist.`
          );
        }

        return items;
      },
      note,
      now,
      one: (item) => {
        seen(item.meta);

        return item;
      },
      outbound,
      page: (page) => {
        seen(page.meta);

        if (!page.complete) {
          partial("Only the first page of a listing was read.");
        }

        return page.items;
      },
      partial,
      rows: (stats) => {
        seen(stats.meta);

        return stats.rows;
      },
    },
    meta: () => ({ complete, evidence, notes: [...notes], requests }),
  };
};

const missing = (
  outbound: OutboundApi,
  needs: readonly CapabilityKey[]
): CapabilityKey[] =>
  needs.filter((key) => outbound.capabilities[key] === false);

const prepare = <Key extends string, Input, Data, Given>(
  outbound: OutboundApi,
  spec: InsightSpec<Key, Input, Data, Given>,
  input: Json | undefined
): Input => {
  // A misspelt or unsupported filter is refused. Dropping it would let the
  // insight quietly answer a wider question than the one asked.
  const stray = unknownKey(Object.keys(spec.inputSchema.shape), input);

  if (stray !== undefined) {
    throw new OutboundError("Invalid", `${spec.name}: ${stray}`, {
      provider: outbound.provider,
    });
  }

  const parsed = spec.inputSchema.safeParse(input ?? {});

  if (!parsed.success) {
    const [issue] = parsed.error.issues;

    throw new OutboundError(
      "Invalid",
      `${spec.name}: ${issue?.path.join(".") || "input"} ${issue?.message ?? "is invalid"}`,
      { provider: outbound.provider }
    );
  }

  const absent = missing(outbound, spec.needs);
  // What only this input needs is named apart, so the caller knows another input may work.
  const forInput = missing(outbound, spec.needsFor?.(parsed.data) ?? []);

  if (absent.length > 0 || forInput.length > 0) {
    throw new OutboundError(
      "Unsupported",
      `${spec.name} is not available${absent.length > 0 ? "" : " for this input"}: the ${outbound.provider} adapter does not support ${[...new Set([...absent, ...forInput])].join(", ")}`,
      { provider: outbound.provider }
    );
  }

  return parsed.data;
};

const execute = async <Key extends string, Input, Data, Given>(
  outbound: OutboundApi,
  spec: InsightSpec<Key, Input, Data, Given>,
  input: Json | undefined,
  options: RunOptions = {}
): Promise<InsightResult<Data>> => {
  const checked = prepare(outbound, spec, input);
  const now = options.now ?? Date.now();
  const tracker = track(outbound, now);
  const data = await spec.run(tracker.context, checked);

  return {
    data,
    insight: spec.name,
    meta: {
      ...tracker.meta(),
      computedAt: new Date(now).toISOString(),
      provider: outbound.provider,
    },
  };
};

/**
 * Defines an insight. The key, the input type and the data type are kept as
 * written, so `outbound.insights` is typed from the definitions.
 */
export const defineInsight = <const Key extends string, Input, Data, Given>(
  spec: InsightSpec<Key, Input, Data, Given>
): InsightDefinition<Key, Input, Data, Given> => ({
  ...spec,
  execute: async (outbound, input, options) => {
    const result = await execute(outbound, spec, input, options);

    return { ...result, data: toJson(result.data) };
  },
});

/** Checks the input and the capabilities, then runs one insight, keeping its typed answer. */
export const runInsight = <Key extends string, Input, Data, Given>(
  outbound: OutboundApi,
  definition: InsightDefinition<Key, Input, Data, Given>,
  input: Given,
  options: RunOptions = {}
): Promise<InsightResult<Data>> =>
  // SAFETY: an insight's input is a plain object of JSON values, and it is parsed before use.
  execute(outbound, definition, input as Json, options);
