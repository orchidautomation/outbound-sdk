// outbound-sdk/loader: picks the adapter from the environment, so the same
// code runs against any vendor. Each adapter is imported only when chosen.

import type { Adapter } from "../internal/adapter.ts";
import { readEnv } from "../internal/env.ts";
import { OutboundError } from "../internal/errors.ts";
import { PROVIDER_ENV, providers } from "../providers/index.ts";

export interface FromEnvOptions {
  /** Overrides `OUTBOUND_SDK_PROVIDER`. */
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
 * Builds the adapter named by `OUTBOUND_SDK_PROVIDER`, reading its key from
 * that adapter's own environment variables.
 */
export const fromEnv = async (
  options: FromEnvOptions = {}
): Promise<Adapter> => {
  const id = options.provider ?? readEnv(PROVIDER_ENV);

  if (id === undefined) {
    throw new OutboundError(
      "Invalid",
      `Set ${PROVIDER_ENV} to one of: ${providers.map((provider) => provider.id).join(", ")}`
    );
  }

  const load = LOADERS.get(id);

  if (load === undefined) {
    throw new OutboundError(
      "Invalid",
      `Unknown provider "${id}". Known providers: ${loadableProviders().join(", ")}`
    );
  }

  return await load();
};
