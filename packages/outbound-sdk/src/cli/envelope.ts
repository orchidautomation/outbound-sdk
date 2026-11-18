// Every command's answer in one shape, so a script or an agent parses one
// thing and reads from stdout whether the answer is complete:
//
//   { ok, data, meta: { complete, notes, provider, requests, throttledMs, ... }, next? }

import {
  field,
  isBoolean,
  isJsonArray,
  isJsonObject,
  isString,
} from "../internal/json.ts";
import type { Json, JsonObject } from "../internal/json.ts";
import type { OutboundPlugin } from "../internal/outbound/plugins.ts";

/** How much of what was asked an answer covers. */
export interface Coverage {
  /** `true` all of it, `false` part of it (`notes` says why). */
  readonly complete: boolean;
  readonly notes: readonly string[];
}

/** What a list's walk knows besides its records. */
export interface Walked {
  /** `true` when `--limit` stopped the walk while more records exist. */
  readonly truncated?: boolean | undefined;
  /** Where to resume with `--cursor`. `undefined` on a truncated walk means from the start. */
  readonly cursor?: string | undefined;
  /** How many of the records printed last a resumed walk reads again. */
  readonly repeats?: number | undefined;
  /** `true` when the records were already written as JSON lines. */
  readonly streamed?: boolean | undefined;
  /** How many records the walk handed out. */
  readonly records?: number | undefined;
}

/** An answer with what the JSON itself cannot carry: whether `--limit` cut a list. */
export class Answer {
  readonly value: Json;
  readonly coverage: Coverage;
  /** `true` for a list, which the envelope puts in `data.items`. */
  readonly list: boolean;
  readonly walked: Walked;
  /** Printed as it is in place of the envelope, as `--card` prints a card. */
  readonly text: string | undefined;

  constructor(
    value: Json,
    coverage: Coverage,
    list = false,
    walked: Walked = {},
    text?: string
  ) {
    this.value = value;
    this.coverage = coverage;
    this.list = list;
    this.walked = walked;
    this.text = text;
  }

  /** How many records a list holds; 0 for an answer that is not a list. */
  get size(): number {
    return this.list && isJsonArray(this.value) ? this.value.length : 0;
  }
}

/** What a command printed, as the printer receives it. */
export type Printed = Json | Answer;

export const valueOf = (printed: Printed): Json =>
  printed instanceof Answer ? printed.value : printed;

const notesOf = (value: Json | undefined): string[] =>
  isJsonArray(value) ? value.filter(isString) : [];

/** A tool result: `{ ok, data, meta, next }` or `{ ok: false, error, next }`. */
const isToolResult = (value: Json): value is JsonObject =>
  isJsonObject(value) &&
  isBoolean(value.ok) &&
  isString(value.next) &&
  ("data" in value || "error" in value);

/**
 * What the answer says about its own coverage: a tool result, record, stats,
 * thread or insight says it in its `meta`. A failed tool result is not
 * complete. An answer with no `meta`, such as `capabilities` or `tools`, is
 * read in full, so it is complete.
 */
export const coverageOf = (printed: Printed): Coverage => {
  if (printed instanceof Answer) {
    return printed.coverage;
  }

  const meta = isJsonObject(printed) ? printed.meta : undefined;
  const stated = isJsonObject(meta) ? meta.complete : undefined;

  if (isBoolean(stated)) {
    return { complete: stated, notes: notesOf(field(meta, "notes")) };
  }

  if (isToolResult(printed)) {
    return { complete: false, notes: [] };
  }

  return { complete: true, notes: [] };
};

/** Several sections printed together, keyed by name: complete only when each is. */
export const sections = (
  entries: readonly (readonly [string, Printed])[]
): Answer => {
  const all = entries.map(([, printed]) => coverageOf(printed));

  const complete = all.every((each) => each.complete);

  return new Answer(
    Object.fromEntries(
      entries.map(([name, printed]) => [name, valueOf(printed)])
    ),
    { complete, notes: all.flatMap((each) => each.notes) }
  );
};

/** What the run knows besides the answer. */
export interface RunFacts {
  /** The adapter's id, or `null` before one was chosen. */
  readonly provider: string | null;
  /** Vendor requests the command sent. */
  readonly requests: number;
  /** Milliseconds the command spent waiting on rate limits, overlaps counted once. */
  readonly throttledMs: number;
}

/** Counts every vendor request the command sends, for `meta.requests`. */
export const requestCounter = (): OutboundPlugin & {
  readonly sent: () => number;
} => {
  let sent = 0;

  return {
    hooks: {
      onRequest: () => {
        sent += 1;
      },
    },
    name: "cli-request-count",
    sent: () => sent,
  };
};

const WRAPPER_KEYS = new Set(["data", "insight", "meta"]);

const isWrapper = (value: JsonObject): boolean =>
  "data" in value &&
  "meta" in value &&
  Object.keys(value).every((key) => WRAPPER_KEYS.has(key));

// The value without its own `meta`, which the envelope's meta takes over.
const withoutMeta = (value: JsonObject): JsonObject =>
  Object.fromEntries(Object.entries(value).filter(([key]) => key !== "meta"));

const dataOf = (printed: Printed): Json => {
  const value = valueOf(printed);

  if ((printed instanceof Answer && printed.list) || isJsonArray(value)) {
    return { items: value };
  }

  if (!isJsonObject(value)) {
    return value;
  }

  // An answer that wraps its data, `{ data, meta }` from `native` or
  // `{ insight, data, meta }` from an insight, is unwrapped. An insight's
  // name joins the meta.
  if (isWrapper(value)) {
    return value.data ?? null;
  }

  return withoutMeta(value);
};

/** The answer in the envelope. */
export const envelope = (printed: Printed, facts: RunFacts): JsonObject => {
  const value = valueOf(printed);
  const { complete, notes } = coverageOf(printed);
  const own = field(value, "meta");

  const insight = field(value, "insight");

  const meta: JsonObject = {
    ...(isJsonObject(own) ? own : undefined),
    complete,
    notes: [...notes],
    provider: facts.provider ?? field(own, "provider") ?? null,
    requests: facts.requests,
    throttledMs: facts.throttledMs,
  };

  if (printed instanceof Answer && printed.walked.truncated === true) {
    meta.cursor = printed.walked.cursor ?? null;
    meta.repeats = printed.walked.repeats ?? 0;
  }

  if (isString(insight)) {
    meta.insight = insight;
  }

  if (isToolResult(value)) {
    const ok = value.ok === true;

    const wrapped: JsonObject = {
      data: value.data ?? null,
      meta,
      next: value.next ?? null,
      ok,
    };

    if (!ok) {
      wrapped.error = value.error ?? null;
    }

    return wrapped;
  }

  return { data: dataOf(printed), meta, ok: true };
};

/** Why a command failed: the code and message stderr prints. */
export interface Failure {
  readonly code: string;
  readonly message: string;
  /** Where a list that failed part way resumes with `--cursor`; `null` from the start. */
  readonly cursor?: string | null | undefined;
}

/** A command that threw, in the envelope. stderr still gets the one-line reason. */
export const failedEnvelope = (
  failure: Failure,
  facts: RunFacts
): JsonObject => {
  const meta: JsonObject = {
    complete: false,
    notes: [],
    provider: facts.provider,
    requests: facts.requests,
    throttledMs: facts.throttledMs,
  };

  if (failure.cursor !== undefined) {
    meta.cursor = failure.cursor;
  }

  return {
    data: null,
    error: { code: failure.code, message: failure.message },
    meta,
    ok: false,
  };
};
