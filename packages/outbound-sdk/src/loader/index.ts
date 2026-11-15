// outbound-sdk/loader: picks the adapter from the environment, so the same
// code runs against any vendor. Each adapter is imported only when chosen.
//
// With no provider named it behaves as `all`: someone who sets an Instantly
// and a HeyReach key gets both, behind one instance, without choosing.

import type { Adapter } from "../internal/adapter.ts";
import { readEnv } from "../internal/env.ts";
import { OutboundError } from "../internal/errors.ts";
import { PROVIDER_ENV, providers } from "../providers/index.ts";

export interface FromEnvOptions {
  /** Overrides `OUTBOUND_SDK_PROVIDER`. A provider id, or `all`, which is also the default. */
  readonly provider?: string | undefined;
}

const LOADERS = new Map<string, () => Promise<Adapter>>([
  [
    "instantly",
    async () => {
      const { instantly } = await import("../instantly/index.ts");

      return instantly();
    },
  ],
  [
    "smartlead",
    async () => {
      const { smartlead } = await import("../smartlead/index.ts");

      return smartlead();
    },
  ],
  [
    "heyreach",
    async () => {
      const { heyreach } = await import("../heyreach/index.ts");

      return heyreach();
    },
  ],
  [
    "memory",
    async () => {
      const { demoData, memory } = await import("../memory/index.ts");

      return memory({ data: demoData() });
    },
  ],
]);

/** The provider ids `fromEnv` can load. */
export const loadableProviders = (): string[] => [...LOADERS.keys()].toSorted();

/**
 * In place of a provider id: every provider whose key is set, behind one
 * instance. A key added to the environment adds its tool; no code changes.
 */
export const ALL_PROVIDERS = "all";

/**
 * The providers whose every required variable is set, in catalog order. A
 * provider that needs no key, such as `memory`, is never among them.
 */
export const configuredProviders = (): string[] =>
  providers
    .filter((provider) => {
      const required = provider.envVars.filter((variable) => variable.required);

      return (
        LOADERS.has(provider.id) &&
        required.length > 0 &&
        required.every((variable) => readEnv(variable.name) !== undefined)
      );
    })
    .map((provider) => provider.id);

const keyNames = (): string[] =>
  providers.flatMap((provider) =>
    provider.envVars
      .filter((variable) => variable.required)
      .map((variable) => variable.name)
  );

const loadEvery = async (named: boolean): Promise<Adapter> => {
  const adapters = await Promise.all(
    configuredProviders().flatMap((id) => {
      const load = LOADERS.get(id);

      return load === undefined ? [] : [load()];
    })
  );

  const [only] = adapters;

  if (only === undefined) {
    throw new OutboundError(
      "Invalid",
      named
        ? `No provider key is set, so "${ALL_PROVIDERS}" has nothing to build. Set at least one of: ${keyNames().join(", ")}`
        : `No provider key is set. Set at least one of: ${keyNames().join(", ")}, or set ${PROVIDER_ENV} to one of: ${providers.map((provider) => provider.id).join(", ")}`
    );
  }

  if (adapters.length === 1) {
    return only;
  }

  const { combine } = await import("../combine/index.ts");

  return combine(adapters);
};

/**
 * Builds the adapter named by `OUTBOUND_SDK_PROVIDER`, reading its key from
 * that adapter's own environment variables. `all` builds every provider whose
 * key is set: one adapter alone, or several combined. With no provider named,
 * it does the same as `all`.
 */
export const fromEnv = async (
  options: FromEnvOptions = {}
): Promise<Adapter> => {
  const id = options.provider ?? readEnv(PROVIDER_ENV);

  if (id === undefined || id === ALL_PROVIDERS) {
    return await loadEvery(id !== undefined);
  }

  const load = LOADERS.get(id);

  if (load === undefined) {
    throw new OutboundError(
      "Invalid",
      `Unknown provider "${id}". Known providers: ${loadableProviders().join(", ")}, or ${ALL_PROVIDERS}`
    );
  }

  return await load();
};
