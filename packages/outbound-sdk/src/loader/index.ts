// outbound-sdk/loader: picks the adapter from the environment, so the same
// code runs against any vendor. Each adapter is imported only when chosen.
//
// With no provider named it behaves as `all`: someone who sets an Instantly
// and a HeyReach key gets both, behind one instance, without choosing.

import type { Adapter } from "../internal/adapter.ts";
import { readEnv } from "../internal/env.ts";
import { OutboundError } from "../internal/errors.ts";
import {
  leadFieldMapSchema,
  leadFieldsInvalid,
} from "../internal/lead-fields.ts";
import type { LeadFieldMap } from "../internal/lead-fields.ts";
import {
  LEAD_FIELDS_ENV,
  PROVIDER_ENV,
  providers,
} from "../providers/index.ts";

export interface FromEnvOptions {
  /** Overrides `OUTBOUND_SDK_PROVIDER`. A provider id, or `all`, which is also the default. */
  readonly provider?: string | undefined;
  /**
   * Every adapter's `leadFields`: the custom fields to read a lead field
   * from where the vendor's own is empty. Overrides `OUTBOUND_LEAD_FIELDS`.
   */
  readonly leadFields?: LeadFieldMap | undefined;
}

interface LoadOptions {
  readonly leadFields: LeadFieldMap | undefined;
}

const LOADERS = new Map<string, (options: LoadOptions) => Promise<Adapter>>([
  [
    "instantly",
    async (options) => {
      const { instantly } = await import("../instantly/index.ts");

      return instantly(options);
    },
  ],
  [
    "smartlead",
    async (options) => {
      const { smartlead } = await import("../smartlead/index.ts");

      return smartlead(options);
    },
  ],
  [
    "heyreach",
    async (options) => {
      const { heyreach } = await import("../heyreach/index.ts");

      return heyreach(options);
    },
  ],
  [
    "emailbison",
    async (options) => {
      const { emailbison } = await import("../emailbison/index.ts");

      return emailbison(options);
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

/** `OUTBOUND_LEAD_FIELDS`, parsed and checked; `undefined` when unset. */
const envLeadFields = (): LeadFieldMap | undefined => {
  const text = readEnv(LEAD_FIELDS_ENV);

  if (text === undefined) {
    return undefined;
  }

  let parsed: unknown;

  try {
    parsed = JSON.parse(text);
  } catch (error) {
    throw new OutboundError(
      "Invalid",
      `${LEAD_FIELDS_ENV} is not JSON. Set it like {"linkedinUrl":["linkedin_profile","linkedin_url"]}`,
      { cause: error }
    );
  }

  const checked = leadFieldMapSchema.safeParse(parsed);

  if (!checked.success) {
    throw leadFieldsInvalid(LEAD_FIELDS_ENV, checked.error);
  }

  return checked.data;
};

const loadEvery = async (
  named: boolean,
  options: LoadOptions
): Promise<Adapter> => {
  const adapters = await Promise.all(
    configuredProviders().flatMap((id) => {
      const load = LOADERS.get(id);

      return load === undefined ? [] : [load(options)];
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
  const load = { leadFields: options.leadFields ?? envLeadFields() };

  if (id === undefined || id === ALL_PROVIDERS) {
    return await loadEvery(id !== undefined, load);
  }

  const loader = LOADERS.get(id);

  if (loader === undefined) {
    throw new OutboundError(
      "Invalid",
      `Unknown provider "${id}". Known providers: ${loadableProviders().join(", ")}, or ${ALL_PROVIDERS}`
    );
  }

  return await loader(load);
};
