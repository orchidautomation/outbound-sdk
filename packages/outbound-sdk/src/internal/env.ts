// Adapters read their API key from the environment by default. Not every
// runtime has `process`, so the lookup goes through here.

import { OutboundError } from "./errors.ts";

interface EnvironmentHost {
  readonly process?: {
    readonly env?: Readonly<Record<string, string | undefined>>;
  };
}

/** The variable's value, or `undefined` when it is unset or empty. */
export const readEnv = (name: string): string | undefined => {
  // SAFETY: globalThis may or may not carry Node's process; both cases are handled.
  const value = (globalThis as EnvironmentHost).process?.env?.[name];

  return value === undefined || value.trim() === "" ? undefined : value.trim();
};

/** An explicit option, else the environment variable, else `Unauthorized`. */
export const requireCredential = (
  explicit: string | undefined,
  envName: string,
  provider: string
): string => {
  const value = explicit?.trim() || readEnv(envName);

  if (value === undefined || value === "") {
    throw new OutboundError(
      "Unauthorized",
      `${provider} needs an API key: pass apiKey or set ${envName}`,
      { provider }
    );
  }

  return value;
};
