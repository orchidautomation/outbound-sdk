// Plugins compose as an ordered onion: plugins[0] is the outermost layer.
// A plugin can wrap operations, narrow what the instance advertises, add
// namespaced methods and rewrite webhook events. It can never widen what the
// adapter declared.

import type { Adapter } from "../adapter.ts";
import { CAPABILITY_KEYS, intersectCapabilities } from "../capabilities.ts";
import type { Capabilities, CapabilityKey } from "../capabilities.ts";
import type { CallState } from "../engine/request.ts";
import type { OutboundEvent } from "../entities.ts";
import { OutboundError } from "../errors.ts";
import type { OutboundApi } from "./api.ts";
import type { Operation, OperationOutput } from "./operations.ts";

export interface OperationInfo {
  readonly provider: string;
  readonly workspaceId: string;
  readonly adapter: Adapter;
  /** What the call has used so far. Plugins may read it and may add to it. */
  readonly state: CallState;
}

export type NextOperation = (operation: Operation) => Promise<OperationOutput>;

export interface OutboundPlugin<Extension = unknown> {
  /** Names the plugin in errors and diagnostics. */
  readonly name: string;
  /** Intercepts an operation. Call `next` to continue inward. */
  readonly wrap?: (
    operation: Operation,
    next: NextOperation,
    info: OperationInfo
  ) => Promise<OperationOutput>;
  /** Returns the capabilities to advertise. Anything it widens is ignored. */
  readonly capabilities?: (capabilities: Capabilities) => Capabilities;
  /** Adds methods to the instance. A name that already exists is an error. */
  readonly extend?: (outbound: OutboundApi) => Extension;
  /** Rewrites a webhook event, or returns `null` to drop it. */
  readonly event?: (event: OutboundEvent) => OutboundEvent | null;
}

export interface NarrowedCapabilities {
  readonly capabilities: Capabilities;
  readonly narrowedBy: ReadonlyMap<CapabilityKey, string>;
}

/** Applies each plugin's `capabilities` hook, recording who turned what off. */
export const narrowCapabilities = (
  declared: Capabilities,
  plugins: readonly OutboundPlugin[]
): NarrowedCapabilities => {
  const narrowedBy = new Map<CapabilityKey, string>();
  let current = declared;

  for (const plugin of plugins) {
    if (plugin.capabilities !== undefined) {
      // Intersecting with the input means a plugin can only take away.
      const next = intersectCapabilities(
        current,
        plugin.capabilities({ ...current })
      );

      for (const key of CAPABILITY_KEYS) {
        if (next[key] === false && current[key] !== false) {
          narrowedBy.set(key, plugin.name);
        }
      }

      current = next;
    }
  }

  return { capabilities: current, narrowedBy };
};

/** Folds the plugins' `wrap` functions around the innermost step. */
export const composeOperations = (
  plugins: readonly OutboundPlugin[],
  innermost: (
    operation: Operation,
    info: OperationInfo
  ) => Promise<OperationOutput>
): ((
  operation: Operation,
  info: OperationInfo
) => Promise<OperationOutput>) => {
  const wraps = plugins.flatMap((plugin) =>
    plugin.wrap === undefined ? [] : [plugin.wrap]
  );

  return (operation, info) => {
    const run = (
      index: number,
      current: Operation
    ): Promise<OperationOutput> => {
      const wrap = wraps[index];

      return wrap === undefined
        ? innermost(current, info)
        : wrap(current, (inner) => run(index + 1, inner), info);
    };

    return run(0, operation);
  };
};

/** Runs every plugin's `event` hook, innermost first. `null` drops the event. */
export const applyEventHooks = (
  plugins: readonly OutboundPlugin[],
  event: OutboundEvent
): OutboundEvent | null => {
  let current: OutboundEvent | null = event;

  for (const plugin of plugins.toReversed()) {
    if (current === null) {
      return null;
    }

    current = plugin.event === undefined ? current : plugin.event(current);
  }

  return current;
};

export const assertUniquePluginNames = (
  plugins: readonly OutboundPlugin[]
): void => {
  const seen = new Set<string>();

  for (const plugin of plugins) {
    if (seen.has(plugin.name)) {
      throw new OutboundError(
        "Invalid",
        `The ${plugin.name} plugin is listed twice`
      );
    }

    seen.add(plugin.name);
  }
};
