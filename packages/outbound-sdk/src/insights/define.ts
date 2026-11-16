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
import {
  namesCampaign,
  routedByCampaign,
  withCampaign,
} from "../tools/by-name.ts";
import { inputProblem } from "../tools/input-problem.ts";
import type { InsightCost } from "./cost.ts";
import { runCap } from "./run-cap.ts";
import type { CapOptions, RunCap } from "./run-cap.ts";
import { capNote, readsOf, stopNote } from "./tracked-reads.ts";
import type { Cap } from "./tracked-reads.ts";

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
  /** The token the plugin writes in place of a value in a masked field. */
  readonly hash?: ((value: string) => string) | undefined;
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

export type { Cap } from "./tracked-reads.ts";

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
  /**
   * Reads each item, a few side by side, and returns the results in order.
   * In an insight with `partialOnCap`, an item whose read a request cap
   * stopped is left out, and the answer is marked incomplete with a note
   * such as `Read 18 of 24 campaigns`; `what` names the items in the plural.
   * Any other failure, and every failure elsewhere, is thrown.
   */
  readonly each: <Item, Result>(
    items: readonly Item[],
    read: (item: Item) => Promise<Result>,
    what: string
  ) => Promise<Result[]>;
  /** Adds a note to the answer. The same note is kept once. */
  readonly note: (text: string) => void;
  /** Marks the answer as covering part of the data, with the reason as a note. */
  readonly partial: (reason: string) => void;
  /**
   * Says how many campaigns the insight found, once its campaign listing is
   * read. A run whose least cost for that many is over its cap stops there.
   */
  readonly campaignsFound: (count: number) => void;
}

export interface RunOptions extends CapOptions {
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
  /** What a run costs, for the default cap and the check before the first request. */
  readonly cost?: InsightCost<never> | undefined;
  /** The input that makes the insight cheaper when lowered, named in cap messages. */
  readonly scales?: string | undefined;
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
  /**
   * What a run costs in vendor requests, written once with `price`. It is
   * worked out at the least and the most every read can cost: the most sets
   * the default cap, and a run whose least is over its cap is refused before
   * the first request. Without it the insight has no default cap.
   */
  readonly cost?: InsightCost<Input> | undefined;
  /** The input that makes a run cheaper when lowered, such as `max_campaigns`. */
  readonly scales?: (keyof Input & string) | undefined;
  /**
   * `true` when the answer still means something over part of the data: a
   * request cap that stops `context.all` or `context.each` part way then
   * keeps what they read, and the answer comes back with `complete: false`
   * and a note naming the cap, instead of failing with `RateLimited`.
   */
  readonly partialOnCap?: boolean | undefined;
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
  readonly cost?: InsightCost<Input> | undefined;
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
  /** `true` once a read a request cap stopped was kept out of the answer. */
  readonly absorbed: () => boolean;
  /** `context.all` that never keeps a listing a cap cut short, for a lookup that must see every record. */
  readonly strictAll: InsightContext["all"];
}

const track = (cap: RunCap, now: number, partialOnCap: boolean): Tracker => {
  const { outbound } = cap;
  const notes: string[] = [];
  let requests = 0;
  let evidence: Evidence = "exact";
  let complete = true;
  let absorbed = false;

  // What stopped the read when a request cap did and the read may keep what it got.
  const keptWhen =
    (allowed: boolean) =>
    (cause: unknown): string | undefined => {
      const reached = allowed ? cap.capReached(cause) : undefined;

      absorbed ||= reached !== undefined;

      return reached;
    };

  const note = (text: string): void => {
    if (!notes.includes(text)) {
      notes.push(text);
    }
  };

  const seen = (meta: ResultMeta | undefined): void => {
    if (meta === undefined) {
      return;
    }

    requests += meta.requests;
    evidence = RANK[meta.evidence] > RANK[evidence] ? meta.evidence : evidence;

    for (const text of meta.notes) {
      note(text);
    }
  };

  const partial = (reason: string): void => {
    complete = false;
    note(reason);
  };

  // Where each per-record cap's one note sits in `notes`, and how many stops it counts.
  const perStops = new Map<string, { readonly at: number; times: number }>();

  const stopped = (listed: Cap | string | undefined): void => {
    // oxlint-disable-next-line anti-slop/no-runtime-typeof -- `listed` is a public argument that is either the old free-text form or a `Cap`
    if (typeof listed !== "object" || listed.per === undefined) {
      partial(stopNote(listed));

      return;
    }

    complete = false;

    const key = JSON.stringify([
      listed.max,
      listed.what,
      listed.input,
      listed.per,
    ]);

    const stop = perStops.get(key) ?? { at: notes.push("") - 1, times: 0 };
    stop.times += 1;
    perStops.set(key, stop);
    notes[stop.at] = capNote(listed, stop.times);
  };

  return {
    absorbed: () => absorbed,
    strictAll: readsOf({ kept: keptWhen(false), partial, seen, stopped }).all,
    context: {
      ...readsOf({ kept: keptWhen(partialOnCap), partial, seen, stopped }),
      campaignsFound: cap.campaignsFound,
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
    // A read the cap stopped part way recorded no cost, so the cap's own count is the total.
    meta: () => ({
      complete,
      evidence,
      notes: [...notes],
      requests: absorbed ? Math.max(requests, cap.used()) : requests,
    }),
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
      `${spec.name}: ${inputProblem(input, issue)}`,
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

  return parsed.data;
};

/** Refuses the run when the adapter lacks what the insight or this input needs. */
const refuseUnsupported = <Key extends string, Input, Data, Given>(
  outbound: OutboundApi,
  spec: InsightSpec<Key, Input, Data, Given>,
  input: Input
): void => {
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
  const forInput = missing(outbound, spec.needsFor?.(input) ?? []);

  if (absent.length > 0 || forInput.length > 0) {
    throw new OutboundError(
      "Unsupported",
      `${spec.name} is not available${absent.length > 0 ? "" : " for this input"}: the ${outbound.provider} adapter does not support ${[...new Set([...absent, ...forInput])].join(", ")}`,
      { provider: outbound.provider }
    );
  }
};

const COMBINED = "combined";

/** Whether any tool of a combined instance can serve the insight. Its workspaces are its tools, listed with no request. */
const someMemberServes = async <Key extends string, Input, Data, Given>(
  outbound: OutboundApi,
  spec: InsightSpec<Key, Input, Data, Given>,
  input: Input
): Promise<boolean> => {
  const { items } = await outbound.workspaces.list();

  return items.some((tool) => {
    try {
      refuseUnsupported(
        outbound.workspace(`${tool.provider}:${tool.workspaceId}`),
        spec,
        input
      );

      return true;
    } catch (error) {
      if (OutboundError.is(error) && error.code === "Unsupported") {
        return false;
      }

      throw error;
    }
  });
};

/** The most campaigns a name is looked up among, for the cost of the lookup. */
const NAMED_AMONG = 1000;

/** The spec, its cost raised by the campaign listing a campaign given by name needs. */
const priced = <Key extends string, Input, Data, Given>(
  outbound: OutboundApi,
  spec: InsightSpec<Key, Input, Data, Given>,
  input: Input
): InsightSpec<Key, Input, Data, Given> => {
  const { cost } = spec;

  return cost === undefined || !namesCampaign(outbound, input)
    ? spec
    : {
        ...spec,
        cost: (values, price) =>
          cost(values, price) + price.list("campaigns.list", NAMED_AMONG),
      };
};

const execute = async <Key extends string, Input, Data, Given>(
  outbound: OutboundApi,
  spec: InsightSpec<Key, Input, Data, Given>,
  input: Json | undefined,
  options: RunOptions = {}
): Promise<InsightResult<Data>> => {
  // A campaign ref on a combined instance runs the insight on the member it
  // names, so that member's capabilities apply, not what every member shares.
  const target = routedByCampaign(outbound, input);
  const checked = prepare(target, spec, input);
  // A name says which member it is only once it is looked up.
  const later = namesCampaign(target, checked) && target.provider === COMBINED;

  // A name is looked up only when at least one tool can serve the insight,
  // which takes no request to know.
  if (!later || !(await someMemberServes(target, spec, checked))) {
    refuseUnsupported(target, spec, checked);
  }

  const cap = runCap(target, priced(target, spec, checked), checked, options);
  const now = options.now ?? Date.now();
  const tracker = track(cap, now, spec.partialOnCap === true);

  // A campaign given by name is looked up first, counted like any other read.
  // A name found among part of the campaigns could be another's, so the
  // lookup fails at a cap even where the insight keeps a partial answer.
  const data = await withCampaign(tracker.context.outbound, checked, (walk) =>
    tracker.strictAll(walk)
  )
    .then((resolved) => {
      const member = routedByCampaign(tracker.context.outbound, resolved);

      if (later) {
        refuseUnsupported(member, spec, resolved);
      }

      return spec.run({ ...tracker.context, outbound: member }, resolved);
    })
    .catch(cap.failed);

  const short = cap.shortNote();

  // A read the cap stopped and the answer left out already has its note.
  if (short !== undefined && !tracker.absorbed()) {
    tracker.context.partial(short);
  }

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
