// The five verbs every collection shares: list, listAll, get, exists, getMany.

import type { ZodType } from "zod";

import { decodeCursor, encodeCursor } from "../cursor.ts";
import type { OperationOptions } from "../engine/engine.ts";
import type { CallState } from "../engine/request.ts";
import { OutboundError } from "../errors.ts";
import type { Json } from "../json.ts";
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
import { assertId, assertLimit } from "./validate.ts";
import { PageWalker } from "./walker.ts";

export interface PageRequest {
  readonly limit: number | undefined;
  readonly next: Json | undefined;
}

export interface ListSpec<Item, Filters> {
  readonly action: OperationKind;
  readonly schema: ZodType<Item>;
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

      const failures = output.failures ?? [];
      // A tool that did not answer leaves the page short, whatever the cursor says.
      const complete = output.next === undefined && failures.length === 0;

      const page: PageResult<Item> = {
        complete,
        cursor:
          output.next === undefined
            ? undefined
            : encodeCursor(scope, output.next),
        failures,
        items: checked(core, spec.schema, output.items, spec.action),
        meta: metaFor(core, state, {
          complete,
          evidence: output.evidence,
          fetchedAt: output.fetchedAt,
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
    // SAFETY: with no options every filter is absent, which every Filters type allows.
    const filters = spec.prepare((options ?? {}) as Filters);
    const limit = assertLimit(options?.limit);
    const walkOptions: ListAllOptions | undefined = options;

    return new PageWalker<Item>({
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
  const state = core.engine.begin(options);
  const results: { id: string; value: WithMeta<Item> }[] = [];
  const errors: { id: string; error: OutboundError }[] = [];
  const queue = [...ids];

  const worker = async (): Promise<void> => {
    for (let id = queue.shift(); id !== undefined; id = queue.shift()) {
      try {
        // oxlint-disable-next-line no-await-in-loop -- each worker takes one id at a time.
        const value = await getOne(core, spec, id, options, state, true);
        results.push({ id, value });
      } catch (error) {
        errors.push({ error: toOutboundError(core, error), id });
      }
    }
  };

  const workers = Math.max(
    1,
    Math.min(options?.concurrency ?? DEFAULT_BULK_CONCURRENCY, ids.length)
  );

  await Promise.all(Array.from({ length: workers }, worker));
  const order = new Map(ids.map((id, index) => [id, index]));

  const byOrder = (left: { id: string }, right: { id: string }): number =>
    (order.get(left.id) ?? 0) - (order.get(right.id) ?? 0);

  return {
    errors: errors.toSorted(byOrder),
    results: results.toSorted(byOrder),
  };
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
