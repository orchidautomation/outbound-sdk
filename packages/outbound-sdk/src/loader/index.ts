// outbound-sdk/loader: picks the adapter from the environment, so the same
// code runs against any vendor. Each adapter is imported only when chosen.
//
// With no provider named, every vendor whose key is set is used: one key gives
// that adapter, two or more give one combined instance over all of them, so
// someone with an Instantly and a HeyReach key gets both without choosing.

import type { Adapter } from "../internal/adapter.ts";
import { readEnv } from "../internal/env.ts";
import { OutboundError } from "../internal/errors.ts";
import { PROVIDER_ENV, providers } from "../providers/index.ts";

export interface FromEnvOptions {
  /** Overrides `OUTBOUND_SDK_PROVIDER`. One id, or several separated by commas. */
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

/** The vendors whose required key variables are all set, in catalog order. */
export const configuredProviders = (): string[] =>
  providers.flatMap((provider) => {
    const required = provider.envVars.filter((variable) => variable.required);

    return required.length > 0 &&
      required.every((variable) => readEnv(variable.name) !== undefined)
      ? [provider.id]
      : [];
  });

const keyNames = (): string =>
  providers
    .flatMap((provider) =>
      provider.envVars
        .filter((variable) => variable.required)
        .map((variable) => variable.name)
    )
    .join(", ");

const chosen = (options: FromEnvOptions): string[] => {
  const named = options.provider ?? readEnv(PROVIDER_ENV);

  if (named !== undefined) {
    return [
      ...new Set(
        named
          .split(",")
          .map((id) => id.trim())
          .filter((id) => id !== "")
      ),
    ];
  }

  const configured = configuredProviders();

  if (configured.length === 0) {
    throw new OutboundError(
      "Invalid",
      `No vendor key is set. Set at least one of ${keyNames()}, or set ${PROVIDER_ENV} to one of: ${providers.map((provider) => provider.id).join(", ")}`
    );
  }

  return configured;
};

const load = async (id: string): Promise<Adapter> => {
  const loader = LOADERS.get(id);

  if (loader === undefined) {
    throw new OutboundError(
      "Invalid",
      `Unknown provider "${id}". Known providers: ${loadableProviders().join(", ")}`
    );
  }

  return await loader();
};

/**
 * Builds the adapter named by `OUTBOUND_SDK_PROVIDER` (one id, or several
 * separated by commas). Without it, uses every vendor whose key is set.
 * Several vendors become one combined instance, where each record keeps its
 * own provider.
 */
export const fromEnv = async (
  options: FromEnvOptions = {}
): Promise<Adapter> => {
  const ids = chosen(options);
  const adapters = await Promise.all(ids.map(load));
  const [only] = adapters;

  if (only === undefined) {
    throw new OutboundError(
      "Invalid",
      `${PROVIDER_ENV} names no provider. Known providers: ${loadableProviders().join(", ")}`
    );
  }

  if (adapters.length === 1) {
    return only;
  }

  const { combine } = await import("../combine/index.ts");

  return combine(adapters);
};
