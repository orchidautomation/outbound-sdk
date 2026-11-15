// What the dispatchers share: the output of an operation and the helpers that
// turn an adapter's answer into one.

import type { Adapter, AdapterContext, Page } from "../adapter.ts";
import type { Capabilities } from "../capabilities.ts";
import type { Entity } from "../entities-account.ts";
import type { Evidence, MetricRow } from "../entities.ts";
import { OutboundError } from "../errors.ts";
import type { MemberFailure } from "../failures.ts";
import type { Json } from "../json.ts";
import { sourceIdFor } from "../ref.ts";

/** A record an operation returns. */
export type OutboundRecord = Entity | MetricRow;

export interface OperationOutput {
  readonly items: readonly OutboundRecord[];
  /** The adapter's continuation value, when there is another page. */
  readonly next?: Json | undefined;
  readonly evidence: Evidence;
  /**
   * Members of a combined instance that could not answer while the others
   * did. Absent when every member answered.
   */
  readonly failures?: readonly MemberFailure[] | undefined;
  /** `true` when a plugin served an older answer because the vendor was down. */
  readonly stale?: boolean | undefined;
  /** When the answer was fetched, if a plugin served it from a store. ISO 8601 UTC. */
  readonly fetchedAt?: string | undefined;
}

export const unsupported = (adapter: Adapter, kind: string): OutboundError =>
  new OutboundError(
    "Unsupported",
    `The ${adapter.name} adapter does not implement ${kind}`,
    {
      provider: adapter.name,
    }
  );

export const idFor = (adapter: Adapter, id: string): string =>
  // A combined adapter routes by ref, so it needs the id untouched.
  adapter.members === undefined
    ? sourceIdFor(id, adapter.name, adapter.workspaceId)
    : id;

export const optionalId = (
  adapter: Adapter,
  id: string | undefined
): string | undefined => (id === undefined ? undefined : idFor(adapter, id));

export const output = (
  page: Page<OutboundRecord>,
  derived = false
): OperationOutput => ({
  evidence: derived ? "derived" : "exact",
  items: page.items,
  next: page.next,
  ...(page.failures === undefined ? undefined : { failures: page.failures }),
});

export const single = (item: OutboundRecord): OperationOutput => ({
  evidence: "exact",
  items: [item],
});

export interface DispatchTarget {
  readonly adapter: Adapter;
  readonly capabilities: Capabilities;
  readonly ctx: AdapterContext;
}
