// outbound-sdk/emailbison: the adapter for EmailBison.

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
  BASE_URL_ENV,
  capabilities,
  caveats,
  costs,
  fields,
  limits,
  WORKSPACE_ENV,
} from "./capabilities.ts";
import { createClient } from "./client.ts";
import { NATIVE } from "./native.ts";
import type { EmailBisonNative } from "./native.ts";
import { emailbisonEvents } from "./webhooks.ts";

export const PROVIDER = "emailbison";

/** The environment variables this adapter reads. */
export const envVars = [API_KEY_ENV, BASE_URL_ENV, WORKSPACE_ENV] as const;

export interface EmailBisonOptions {
  /** Defaults to `EMAILBISON_API_KEY`. An `api-user` key is scoped to one workspace. */
  readonly apiKey?: string | undefined;
  /** A label for this client or workspace. Defaults to `EMAILBISON_WORKSPACE_ID`, then `default`. */
  readonly workspaceId?: string | undefined;
  /**
   * The URL you log in to EmailBison with, such as
   * `https://send.example.com`. Defaults to `EMAILBISON_BASE_URL`, then
   * `https://dedi.emailbison.com`.
   */
  readonly baseUrl?: string | undefined;
  /** Overrides what the adapter declares, for example on a key some endpoints refuse. */
  readonly capabilities?: CapabilityDeclaration | undefined;
  /**
   * Which of a lead's custom variables holds a value EmailBison has no field
   * for, for example `{ linkedinUrl: "linkedin_url" }`. Read only where the
   * vendor's own field is empty.
   */
  readonly leadFields?: LeadFieldMap | undefined;
}

export { NATIVE } from "./native.ts";

export type { EmailBisonNative } from "./native.ts";

export const emailbison = (
  options: EmailBisonOptions = {}
): Adapter<EmailBisonNative> => {
  const apiKey = requireCredential(options.apiKey, API_KEY_ENV, PROVIDER);

  const workspaceId = assertWorkspaceId(
    options.workspaceId ?? readEnv(WORKSPACE_ENV) ?? "default",
    PROVIDER
  );

  const client = createClient({
    apiKey,
    baseUrl: options.baseUrl ?? readEnv(BASE_URL_ENV),
    identity: { provider: PROVIDER, workspaceId },
  });

  return {
    ...withLeadFields(readers(client), options.leadFields),
    capabilities: { ...capabilities, ...options.capabilities },
    caveats,
    costs,
    events: emailbisonEvents(PROVIDER),
    fields: withMappedFields(fields, options.leadFields),
    limits,
    mapError: makeErrorMapper(PROVIDER, { secrets: [apiKey] }),
    maturity: "unverified",
    name: PROVIDER,
    native: NATIVE,
    raw: client.raw,
    secrets: [apiKey],
    workspaceId,
  };
};
