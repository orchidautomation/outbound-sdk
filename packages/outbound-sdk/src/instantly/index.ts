// outbound-sdk/instantly: the adapter for Instantly (API V2).

import type { Adapter } from "../internal/adapter.ts";
import type { CapabilityDeclaration } from "../internal/capabilities.ts";
import { readEnv, requireCredential } from "../internal/env.ts";
import { makeErrorMapper } from "../internal/errors.ts";
import { withLeadFields, withMappedFields } from "../internal/lead-fields.ts";
import type { LeadFieldMap } from "../internal/lead-fields.ts";
import { assertWorkspaceId } from "../internal/ref.ts";
import { readers } from "./adapter.ts";
import {
  API_KEY_ENV,
  capabilities,
  caveats,
  costs,
  fields,
  limits,
  WORKSPACE_ENV,
} from "./capabilities.ts";
import { createClient } from "./client.ts";
import { NATIVE } from "./native.ts";
import type { InstantlyNative } from "./native.ts";
import { instantlyEvents } from "./webhooks.ts";

export const PROVIDER = "instantly";

export { NATIVE } from "./native.ts";

export type { InstantlyNative } from "./native.ts";

/** The environment variables this adapter reads. */
export const envVars = [API_KEY_ENV, WORKSPACE_ENV] as const;

export interface InstantlyOptions {
  /** Defaults to `INSTANTLY_API_KEY`. A key with the `all:read` scope is enough. */
  readonly apiKey?: string | undefined;
  /** A label for this client or workspace. Defaults to `INSTANTLY_WORKSPACE_ID`, then `default`. */
  readonly workspaceId?: string | undefined;
  /** For an agency's admin workspace key: the sub workspace to act as. */
  readonly asWorkspace?: string | undefined;
  readonly baseUrl?: string | undefined;
  /** Overrides what the adapter declares, for example on a plan without webhooks. */
  readonly capabilities?: CapabilityDeclaration | undefined;
  /**
   * Which of a lead's custom fields holds a value this vendor has no field
   * for, for example `{ title: "job_title" }`. Read only where the vendor's
   * own field is empty.
   */
  readonly leadFields?: LeadFieldMap | undefined;
}

export const instantly = (
  options: InstantlyOptions = {}
): Adapter<InstantlyNative> => {
  const apiKey = requireCredential(options.apiKey, API_KEY_ENV, PROVIDER);

  const workspaceId = assertWorkspaceId(
    options.workspaceId ?? readEnv(WORKSPACE_ENV) ?? "default",
    PROVIDER
  );

  const given: CapabilityDeclaration = {
    ...capabilities,
    ...options.capabilities,
  };

  // Without tags no campaign can be matched by one.
  const declared: CapabilityDeclaration =
    given.tags === true ? given : { ...given, "campaigns.byTag": false };

  const client = createClient({
    apiKey,
    asWorkspace: options.asWorkspace,
    baseUrl: options.baseUrl,
    identity: { provider: PROVIDER, workspaceId },
    readTags: declared.tags === true,
  });

  return {
    ...withLeadFields(readers(client), options.leadFields),
    capabilities: declared,
    caveats,
    costs,
    events: instantlyEvents(PROVIDER),
    fields: withMappedFields(fields, options.leadFields),
    limits,
    // Instantly answers 402 when the plan does not include the endpoint.
    mapError: makeErrorMapper(PROVIDER, {
      secrets: [apiKey],
      statusCodes: { 402: "Unsupported" },
    }),
    maturity: "beta",
    name: PROVIDER,
    native: NATIVE,
    raw: client.raw,
    secrets: [apiKey],
    workspaceId,
  };
};
