// The five verbs every collection shares: list, listAll, get, exists, getMany.

import type { ZodType } from "zod";

import { decodeCursor, encodeCursor } from "../cursor.ts";
import type { OperationOptions } from "../engine/engine.ts";
import type { CallState } from "../engine/request.ts";
import { OutboundError } from "../errors.ts";
import type { Json } from "../json.ts";
import { strayKey } from "../json.ts";
import type {
  BulkOptions,
  BulkResult,
  Collection,
  ListAllOptions,
  ListOptions,
  PageResult,
  ReadCollection,
  WithMeta,
} from "./api.ts";
import { checked, infoFor, metaFor, perform, toOutboundError } from "./core.ts";
import type { Core } from "./core.ts";
import type { Operation, OperationKind } from "./operations.ts";
import {
  assertId,
  assertIdIsString,
  assertLimit,
  assertMax,
} from "./validate.ts";
import { PageWalker } from "./walker.ts";

export interface PageRequest {
  readonly limit: number | undefined;
  readonly next: Json | undefined;
}

export interface ListSpec<Item, Filters> {
  readonly action: OperationKind;
  readonly schema: ZodType<Item>;
  /** Every filter the listing takes. Any other key is refused, so a misspelt filter cannot widen the answer. */
  readonly takes: { readonly [Key in keyof Filters]-?: true };
  /** Checks the filters and the capabilities they need. Returns clean filters. */
  readonly prepare: (filters: Filters) => Filters;
  readonly toOperation: (filters: Filters, page: PageRequest) => Operation;
  /** What makes a record the same record on a later page. The filters are given because they can change that. */
  readonly keyOf: (item: Item, filters: Filters) => string | undefined;
}

export interface GetSpec<Item> {
  readonly action: OperationKind;
  readonly what: string;
  readonly schema: ZodType<Item>;
  /** Checks the capability the lookup needs. */
  readonly prepare: () => void;
  readonly toOperation: (id: string) => Operation;
}

const DEFAULT_BULK_CONCURRENCY = 4;

// The options every listing takes besides its filters. `satisfies` keeps the
// list in step with the option types.
const LIST_ALL_KEYS = Object.keys({
  cursor: true,
  deadline: true,
  limit: true,
  max: true,
  maxRequests: true,
  retries: true,
  signal: true,
  timeout: true,
} satisfies Record<keyof ListAllOptions, true>);

const LIST_KEYS = LIST_ALL_KEYS.filter((key) => key !== "max");

const refuseUnknown = (
  spec: { readonly action: string; readonly takes: object },
  options: ListAllOptions | undefined,
  optionKeys: readonly string[]
): void => {
  // A key left `undefined` changes nothing, so it is not refused.
  const given = Object.entries(options ?? {})
    .filter(([, value]) => value !== undefined)
    .map(([key]) => key);

  const stray = strayKey(
    [...Object.keys(spec.takes), ...optionKeys],
    given,
    "an option"
  );

  if (stray !== undefined) {
    throw new OutboundError("Invalid", `${spec.action}: ${stray}`);
  }
};

const cursorScope = (core: Core, action: string) => ({
  action,
  provider: core.adapter.name,
  workspaceId: core.adapter.workspaceId,
});

const fetchPage = <Item, Filters>(
  core: Core,
  spec: ListSpec<Item, Filters>,
  request: {
    readonly filters: Filters;
    readonly limit: number | undefined;
    readonly cursor: string | undefined;
  },
  options: OperationOptions | undefined,
  shared?: CallState
): Promise<{ readonly page: PageResult<Item>; readonly state: CallState }> =>
  perform(
    core,
    spec.action,
    options,
    async (state) => {
      const scope = cursorScope(core, spec.action);

      const next =
        request.cursor === undefined
          ? undefined
          : decodeCursor(scope, request.cursor);

      const output = await core.run(
        spec.toOperation(request.filters, { limit: request.limit, next }),
        infoFor(core, state)
      );

      const complete = output.next === undefined;

      const page: PageResult<Item> = {
        complete,
        cursor:
          output.next === undefined
            ? undefined
            : encodeCursor(scope, output.next),
        items: checked(core, spec.schema, output.items, spec.action),
        meta: metaFor(core, state, {
          complete,
          evidence: output.evidence,
          fetchedAt: output.fetchedAt,
          notes: output.notes,
          stale: output.stale,
        }),
      };

      return { page, state };
    },
    shared
  );

export const makeReadCollection = <Item, Filters>(
  core: Core,
  spec: ListSpec<Item, Filters>
): ReadCollection<Item, Filters> => ({
  list: async (options) => {
    refuseUnknown(spec, options, LIST_KEYS);
    // SAFETY: with no options every filter is absent, which every Filters type allows.
    const filters = spec.prepare((options ?? {}) as Filters);
    const limit = assertLimit(options?.limit);

    const { page } = await fetchPage(
      core,
      spec,
      { cursor: options?.cursor, filters, limit },
      options
    );

    return page;
  },
  listAll: (options) => {
    refuseUnknown(spec, options, LIST_ALL_KEYS);
    // SAFETY: with no options every filter is absent, which every Filters type allows.
    const filters = spec.prepare((options ?? {}) as Filters);
    const limit = assertLimit(options?.limit);
    assertMax(options?.max);
    const walkOptions: ListAllOptions | undefined = options;

    return new PageWalker<Item>({
      begin: () => core.engine.begin(options),
      cursor: walkOptions?.cursor,
      fetchPage: (cursor, state) =>
        fetchPage(core, spec, { cursor, filters, limit }, options, state),
      keyOf: (item) => spec.keyOf(item, filters),
      max: walkOptions?.max,
    });
  },
});

const isMissing = (error: OutboundError): boolean => error.code === "NotFound";

const getOne = <Item>(
  core: Core,
  spec: GetSpec<Item>,
  id: string,
  options: OperationOptions | undefined,
  shared?: CallState,
  /** `true` where a missing record is an answer (`exists`, `getMany`), so `onError` is not told of it. */
  missingIsAnswer = false
): Promise<WithMeta<Item>> =>
  perform(
    core,
    spec.action,
    options,
    async (state) => {
      const output = await core.run(
        spec.toOperation(assertId(id, spec.what)),
        infoFor(core, state)
      );

      const [item] = checked(core, spec.schema, output.items, spec.action);

      if (item === undefined) {
        throw new OutboundError(
          "NotFound",
          `${spec.what} ${id} was not found`,
          {
            provider: core.adapter.name,
          }
        );
      }

      return {
        ...item,
        meta: metaFor(core, state, {
          complete: true,
          evidence: output.evidence,
          fetchedAt: output.fetchedAt,
          notes: output.notes,
          stale: output.stale,
        }),
      };
    },
    shared,
    missingIsAnswer ? isMissing : undefined
  );

// Async, so a refused lookup rejects like every other failure of the call.
export const makeGetter =
  <Item>(core: Core, spec: GetSpec<Item>) =>
  async (id: string, options?: OperationOptions): Promise<WithMeta<Item>> => {
    spec.prepare();

    return await getOne(core, spec, id, options);
  };

const getMany = async <Item>(
  core: Core,
  spec: GetSpec<Item>,
  ids: readonly string[],
  options: BulkOptions | undefined
): Promise<BulkResult<Item>> => {
  spec.prepare();

  // A wrong type refuses the whole call; an empty id is that id's error.
  for (const id of ids) {
    assertIdIsString(id, spec.what);
  }

  const state = core.engine.begin(options);

  // Each distinct id is read once; a repeated id gets the same answer.
  const distinct = [...new Set(ids)];

  const answers = new Map<
    string,
    { value: WithMeta<Item> } | { error: OutboundError }
  >();

  const queue = [...distinct];

  const worker = async (): Promise<void> => {
    for (let id = queue.shift(); id !== undefined; id = queue.shift()) {
      try {
        // oxlint-disable-next-line no-await-in-loop -- each worker takes one id at a time.
        const value = await getOne(core, spec, id, options, state, true);
        answers.set(id, { value });
      } catch (error) {
        answers.set(id, { error: toOutboundError(core, error) });
      }
    }
  };

  const workers = Math.max(
    1,
    Math.min(options?.concurrency ?? DEFAULT_BULK_CONCURRENCY, distinct.length)
  );

  await Promise.all(Array.from({ length: workers }, worker));
  const results: { id: string; value: WithMeta<Item> }[] = [];
  const errors: { id: string; error: OutboundError }[] = [];

  // In the order of the ids passed, repeats included.
  for (const id of ids) {
    const answer = answers.get(id);

    if (answer !== undefined && "value" in answer) {
      results.push({ id, value: answer.value });
    } else if (answer !== undefined) {
      errors.push({ error: answer.error, id });
    }
  }

  return { errors, results };
};

export const makeCollection = <Item, Filters>(
  core: Core,
  listSpec: ListSpec<Item, Filters>,
  getSpec: GetSpec<Item>
): Collection<Item, Filters> => ({
  ...makeReadCollection(core, listSpec),
  exists: async (id, options) => {
    getSpec.prepare();

    try {
      await getOne(core, getSpec, id, options, undefined, true);

      return true;
    } catch (error) {
      if (OutboundError.is(error) && isMissing(error)) {
        return false;
      }

      throw error;
    }
  },
  get: makeGetter(core, getSpec),
  getMany: (ids, options) => getMany(core, getSpec, ids, options),
});

export type { ListOptions };
