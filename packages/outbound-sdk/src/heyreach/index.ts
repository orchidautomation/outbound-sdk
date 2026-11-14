// outbound-sdk/heyreach: the adapter for HeyReach (LinkedIn outreach).

import type { Adapter } from "../internal/adapter.ts";
import type { CapabilityDeclaration } from "../internal/capabilities.ts";
import { readEnv, requireCredential } from "../internal/env.ts";
import {
  isHttpFailure,
  makeErrorMapper,
  OutboundError,
} from "../internal/errors.ts";
import type { ErrorMapper } from "../internal/errors.ts";
import { field } from "../internal/json.ts";
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
import { heyreachEvents } from "./webhooks.ts";

export const PROVIDER = "heyreach";

/** The environment variables this adapter reads. */
export const envVars = [API_KEY_ENV, WORKSPACE_ENV] as const;

export interface HeyReachOptions {
  /** Defaults to `HEYREACH_API_KEY`. A workspace API key. */
  readonly apiKey?: string | undefined;
  /** A label for this client or workspace. Defaults to `HEYREACH_WORKSPACE_ID`, then `default`. */
  readonly workspaceId?: string | undefined;
  readonly baseUrl?: string | undefined;
  /** Overrides what the adapter declares. */
  readonly capabilities?: CapabilityDeclaration | undefined;
}

// Sequence reads answer 404 CAMPAIGN_API_NOT_ENABLED when the account's plan
// does not include the campaign API. That is not a missing campaign.
const errorMapper = (apiKey: string): ErrorMapper => {
  const byStatus = makeErrorMapper(PROVIDER, { secrets: [apiKey] });

  return (cause) =>
    isHttpFailure(cause) &&
    field(cause.body, "errorCode") === "CAMPAIGN_API_NOT_ENABLED"
      ? new OutboundError(
          "Unsupported",
          "HeyReach's campaign API is not enabled for this account (CAMPAIGN_API_NOT_ENABLED), so sequences cannot be read",
          { cause, provider: PROVIDER, status: cause.status }
        )
      : byStatus(cause);
};

export const heyreach = (options: HeyReachOptions = {}): Adapter => {
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
    events: heyreachEvents(PROVIDER),
    limits,
    mapError: errorMapper(apiKey),
    maturity: "unverified",
    name: PROVIDER,
    raw: client.raw,
    secrets: [apiKey],
    workspaceId,
  };
};
