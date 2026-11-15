// What an insight is. An insight answers one question an operator asks by
// reading through the SDK and doing plain arithmetic on what comes back. It
// calls no model and stores nothing. One definition serves the typed method
// on the instance, the agent tool and the CLI command.

import type { ZodObject, ZodType } from "zod";

import type { CapabilityKey } from "../internal/capabilities.ts";
import type { Evidence, MetricRow } from "../internal/entities.ts";
import { OutboundError } from "../internal/errors.ts";
import { isJsonObject, toJson, unknownKey } from "../internal/json.ts";
import type { Json } from "../internal/json.ts";
import type {
  ListAll,
  OutboundApi,
  PageResult,
  ResultMeta,
  StatsResult,
  WithMeta,
} from "../internal/outbound/api.ts";
import { plural } from "../internal/plural.ts";

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

/** What the redact plugin masks on an instance. */
export interface Masking {
  readonly fields: readonly string[];
  readonly strategy: "hash" | "mask";
}

/**
 * Says why an insight cannot answer with these fields masked, for example
 * `email addresses, which it matches people by`, or `null` when it can.
 */
export type MaskedOut = (masking: Masking) => string | null;

/**
 * Names what this adapter does not report that the insight needs, for
 * example `campaign tags`, or `null` when it reports it.
 */
export type Lacks = (outbound: OutboundApi) => string | null;

interface Redacted {
  readonly redacted: Masking;
}

// The redact plugin says what it masks on the instance. Told apart by shape,
// so the insights do not import that plugin.
const isRedacted = (
  outbound: OutboundApi
): outbound is OutboundApi & Redacted => "redacted" in outbound;

/** What the redact plugin masks here, or `null` without it. */
export const maskingOf = (outbound: OutboundApi): Masking | null =>
  isRedacted(outbound) ? outbound.redacted : null;

/** Why the entry cannot answer under this instance's redact plugin, or `null`. */
export const maskedOutBy = (
  outbound: OutboundApi,
  entry: Pick<InsightEntry, "maskedOut">
): string | null => {
  const masking = maskingOf(outbound);

  return masking === null || entry.maskedOut === undefined
    ? null
    : entry.maskedOut(masking);
};

export interface InsightResult<Data> {
  readonly insight: string;
  readonly data: Data;
  readonly meta: InsightMeta;
}

/**
 * The cap a listing was read up to, for the note when it stops early:
 * `{ input: "max_campaigns", max: 25, what: "campaigns" }` gives "Stopped at
 * 25 campaigns (max_campaigns); more exist."
 */
export interface Cap {
  /** The cap as the caller set it, not the room left under it. */
  readonly max: number;
  /** What was counted, in the plural: `campaigns`, `leads of a campaign`. */
  readonly what: string;
  /** The input that raises the cap, or `null` for a cap no input sets. */
  readonly input: string | null;
}

// A custom insight written before `Cap` existed names its cap as free text,
// such as `50 campaigns`; that form is kept so its code still compiles.
const stopNote = (cap: Cap | string | undefined): string => {
  if (cap === undefined) {
    return "A listing was cut off at its cap; more records exist.";
  }

  // oxlint-disable-next-line anti-slop/no-runtime-typeof -- `cap` is a public argument that is either the old free-text form or a `Cap`
  return typeof cap === "string"
    ? `Stopped at ${cap}; more exist.`
    : capNote(cap);
};

/**
 * `cap.what` for a cap of one: its first plural word in the singular, so
 * `recent replies looked through` becomes `recent reply looked through`.
 */
const oneOf = (what: string): string =>
  what.replace(
    /\b(?<stem>\w+?)(?<end>ies|s)\b/u,
    (_match, stem: string, end: string) => (end === "ies" ? `${stem}y` : stem)
  );

/** The note for a listing that a cap stopped with more records left. */
export const capNote = (cap: Cap): string =>
  `Stopped at ${plural(cap.max, oneOf(cap.what), cap.what)} (${cap.input ?? "a fixed cap"}); more exist.`;

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
   * names what was capped and the input that raises it, for the note. A
   * string such as `50 campaigns` is still accepted, for insights written
   * before the input could be named.
   */
  readonly all: <Item>(
    walk: ListAll<Item>,
    cap?: Cap | string
  ) => Promise<Item[]>;
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
  /** Why the insight cannot answer while the redact plugin masks what it matches on. */
  readonly maskedOut?: MaskedOut | undefined;
  /** What the adapter does not report that the insight needs, beyond a capability. */
  readonly lacks?: Lacks | undefined;
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
  /**
   * What makes the insight unable to answer under the redact plugin, for an
   * insight that matches records by a field redact can mask. Checked before
   * any request, and an insight it refuses is not offered as a tool.
   */
  readonly maskedOut?: MaskedOut | undefined;
  /**
   * What the adapter does not report that the insight needs beyond a
   * capability, such as a field its records never fill. Checked before any
   * request, and an insight it refuses is not offered as a tool.
   */
  readonly lacks?: Lacks | undefined;
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
          partial(stopNote(cap));
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

/** Whether the input leaves out the top-level field at `path`, so the message can say it is required. */
const isAbsent = (
  input: Json | undefined,
  path: readonly PropertyKey[]
): boolean => {
  const [key] = path;

  return (
    path.length === 1 &&
    key !== undefined &&
    (!isJsonObject(input) || input[String(key)] === undefined)
  );
};

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
    const path = issue?.path.join(".") || "input";

    throw new OutboundError(
      "Invalid",
      `${spec.name}: ${isAbsent(input, issue?.path ?? []) ? `\`${path}\` is required` : `${path} ${issue?.message ?? "is invalid"}`}`,
      { provider: outbound.provider }
    );
  }

  const blocked = maskedOutBy(outbound, spec);

  if (blocked !== null) {
    throw new OutboundError(
      "Unsupported",
      `${spec.name} is not available while the redact plugin masks ${blocked}`,
      { provider: outbound.provider }
    );
  }

  const lacked = spec.lacks?.(outbound) ?? null;

  if (lacked !== null) {
    throw new OutboundError(
      "Unsupported",
      `${spec.name} is not available: the ${outbound.provider} adapter does not report ${lacked}`,
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
