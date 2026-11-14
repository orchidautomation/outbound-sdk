// What every collection and handle shares: the adapter, the engine, the
// capability gate and the composed plugin chain.

import type { ZodType } from "zod";

import type { Adapter } from "../adapter.ts";
import type { CapabilityGate } from "../capabilities.ts";
import type { OperationOptions, RequestEngine } from "../engine/engine.ts";
import type { CallState } from "../engine/request.ts";
import type { Evidence } from "../entities.ts";
import { OutboundError } from "../errors.ts";
import { fire } from "../hooks.ts";
import type { ResultMeta } from "./api.ts";
import type {
  Operation,
  OperationOutput,
  OutboundRecord,
} from "./operations.ts";
import type { OperationInfo } from "./plugins.ts";

export interface Core {
  readonly adapter: Adapter;
  readonly engine: RequestEngine;
  readonly gate: CapabilityGate;
  readonly allowWrites: boolean;
  /** One operation through every plugin and then the adapter. */
  readonly run: (
    operation: Operation,
    info: OperationInfo
  ) => Promise<OperationOutput>;
}

export const infoFor = (core: Core, state: CallState): OperationInfo => ({
  adapter: core.adapter,
  provider: core.adapter.name,
  state,
  workspaceId: core.adapter.workspaceId,
});

export const toOutboundError = (core: Core, cause: unknown): OutboundError =>
  OutboundError.is(cause) ? cause : core.adapter.mapError(cause);

/** Runs one SDK call with accounting, hooks and error normalization around it. */
export const perform = async <Result>(
  core: Core,
  action: string,
  options: OperationOptions | undefined,
  body: (state: CallState) => Promise<Result>,
  shared?: CallState,
  /** Says whether a failure is an answer to the caller, not an error: `onError` is not told of it. */
  isAnswer?: (error: OutboundError) => boolean
): Promise<Result> => {
  const state = shared ?? core.engine.begin(options);
  const startedAt = core.engine.now();
  const { hooks } = core.engine;

  const scope = {
    action,
    provider: core.adapter.name,
    workspaceId: core.adapter.workspaceId,
  };

  const done = (): void => {
    fire(hooks.onAction, {
      ...scope,
      durationMs: core.engine.now() - startedAt,
      requests: state.requests,
      throttledMs: state.throttledMs,
    });
  };

  try {
    const result = await body(state);
    done();

    return result;
  } catch (error) {
    const mapped = toOutboundError(core, error);

    if (isAnswer?.(mapped) === true) {
      done();
    } else {
      fire(hooks.onError, { ...scope, error: mapped });
    }

    throw mapped;
  }
};

export interface MetaInput {
  readonly evidence: Evidence;
  readonly complete: boolean;
  readonly stale?: boolean | undefined;
  readonly fetchedAt?: string | undefined;
}

export const metaFor = (
  core: Core,
  state: CallState,
  input: MetaInput
): ResultMeta => ({
  complete: input.complete,
  evidence: input.evidence,
  fetchedAt: input.fetchedAt ?? new Date(core.engine.now()).toISOString(),
  provider: core.adapter.name,
  requests: state.requests,
  stale: input.stale ?? false,
  throttledMs: state.throttledMs,
  workspaceId: core.adapter.workspaceId,
});

const matches = <Item>(
  schema: ZodType<Item>,
  record: OutboundRecord
): record is Item & OutboundRecord => schema.safeParse(record).success;

/**
 * Checks what came back against the schema. An adapter or plugin that
 * returns a malformed record fails here, loudly, and not in the caller.
 */
export const checked = <Item>(
  core: Core,
  schema: ZodType<Item>,
  records: readonly OutboundRecord[],
  action: string
): Item[] => {
  const items: Item[] = [];

  for (const record of records) {
    if (!matches(schema, record)) {
      const issue = schema.safeParse(record).error?.issues[0];

      const where =
        issue === undefined
          ? ""
          : ` at ${issue.path.join(".")}: ${issue.message}`;

      throw new OutboundError(
        "Provider",
        `The ${core.adapter.name} adapter returned an invalid record for ${action}${where}`,
        { provider: core.adapter.name }
      );
    }

    items.push(record);
  }

  return items;
};
