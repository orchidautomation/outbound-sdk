// outbound-sdk/smartlead: the adapter for Smartlead (API v1).

import type { Adapter } from "../internal/adapter.ts";
import type { CapabilityDeclaration } from "../internal/capabilities.ts";
import { readEnv, requireCredential } from "../internal/env.ts";
import { makeErrorMapper } from "../internal/errors.ts";
import { assertWorkspaceId } from "../internal/ref.ts";
import { readers } from "./adapter.ts";
import {
  API_KEY_ENV,
  capabilities,
  caveats,
  costs,
  limits,
  WORKSPACE_ENV,
} from "./capabilities.ts";
import { createClient } from "./client.ts";
import { NATIVE } from "./native.ts";
import type { SmartleadNative } from "./native.ts";
import { smartleadEvents } from "./webhooks.ts";

export const PROVIDER = "smartlead";

/** The environment variables this adapter reads. */
export const envVars = [API_KEY_ENV, WORKSPACE_ENV] as const;

export interface SmartleadOptions {
  /** Defaults to `SMARTLEAD_API_KEY`. An admin key or a client-level key. */
  readonly apiKey?: string | undefined;
  /** A label for this client or workspace. Defaults to `SMARTLEAD_WORKSPACE_ID`, then `default`. */
  readonly workspaceId?: string | undefined;
  readonly baseUrl?: string | undefined;
  /** Overrides what the adapter declares, for example on a key some endpoints refuse. */
  readonly capabilities?: CapabilityDeclaration | undefined;
}

export type { SmartleadNative } from "./native.ts";

export const smartlead = (
  options: SmartleadOptions = {}
): Adapter<SmartleadNative> => {
  const apiKey = requireCredential(options.apiKey, API_KEY_ENV, PROVIDER);

  const workspaceId = assertWorkspaceId(
    options.workspaceId ?? readEnv(WORKSPACE_ENV) ?? "default",
    PROVIDER
  );

  const client = createClient({
    apiKey,
    baseUrl: options.baseUrl,
    identity: { provider: PROVIDER, workspaceId },
  });

  return {
    ...readers(client),
    capabilities: { ...capabilities, ...options.capabilities },
    caveats,
    costs,
    events: smartleadEvents(PROVIDER),
    limits,
    mapError: makeErrorMapper(PROVIDER, { secrets: [apiKey] }),
    maturity: "unverified",
    name: PROVIDER,
    native: NATIVE,
    raw: client.raw,
    // The key is in every URL, so the engine must redact it everywhere.
    secrets: [apiKey],
    workspaceId,
  };
};
