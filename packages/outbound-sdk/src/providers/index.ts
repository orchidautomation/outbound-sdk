// outbound-sdk/providers: a pure-data catalog of the adapters. It imports
// nothing, so a CLI or a setup screen can list providers and their
// environment variables without loading any adapter. A test keeps it in step
// with the package's exports and with each adapter.

export interface ProviderEnvVar {
  readonly name: string;
  readonly required: boolean;
  readonly description: string;
}

export interface ProviderInfo {
  /** The provider id records carry, and the subpath: `outbound-sdk/<id>`. */
  readonly id: string;
  readonly name: string;
  readonly channels: readonly ("email" | "linkedin")[];
  /** `stable` once checked against live credentials. */
  readonly maturity: "beta" | "stable" | "unverified";
  /** What that maturity rests on, in one plain sentence. */
  readonly note: string;
  readonly envVars: readonly ProviderEnvVar[];
  /** The vendor's API documentation. */
  readonly docsUrl: string | null;
}

const CATALOG = [
  {
    channels: ["email"],
    docsUrl: "https://developer.instantly.ai/",
    envVars: [
      {
        description: "API V2 key. The all:read scope is enough.",
        name: "INSTANTLY_API_KEY",
        required: true,
      },
      {
        description: "A label for this client or workspace.",
        name: "INSTANTLY_WORKSPACE_ID",
        required: false,
      },
    ],
    id: "instantly",
    maturity: "beta",
    name: "Instantly",
    note: "Its reads were run, read-only, against one live workspace. Fixtures are built from the documentation.",
  },
  {
    channels: ["email"],
    docsUrl: "https://api.smartlead.ai",
    envVars: [
      {
        description: "API key. It is sent as a query parameter.",
        name: "SMARTLEAD_API_KEY",
        required: true,
      },
      {
        description: "A label for this client or workspace.",
        name: "SMARTLEAD_WORKSPACE_ID",
        required: false,
      },
    ],
    id: "smartlead",
    maturity: "unverified",
    name: "Smartlead",
    note: "Never run against a live account. Written from the public documentation and tested offline only.",
  },
  {
    channels: ["linkedin"],
    docsUrl: "https://docs.heyreach.io/hey-reach-api.md",
    envVars: [
      {
        description: "A workspace API key.",
        name: "HEYREACH_API_KEY",
        required: true,
      },
      {
        description: "A label for this client or workspace.",
        name: "HEYREACH_WORKSPACE_ID",
        required: false,
      },
    ],
    id: "heyreach",
    maturity: "beta",
    name: "HeyReach",
    note: "Its reads were run, read-only, against one live workspace. Fixtures are built from the documentation.",
  },
  {
    channels: ["email"],
    docsUrl: "https://dedi.emailbison.com/api/reference",
    envVars: [
      {
        description: "API key (an api-user key is scoped to one workspace).",
        name: "EMAILBISON_API_KEY",
        required: true,
      },
      {
        description:
          "The URL you log in to EmailBison with. Defaults to https://dedi.emailbison.com.",
        name: "EMAILBISON_BASE_URL",
        required: false,
      },
      {
        description: "A label for this client or workspace.",
        name: "EMAILBISON_WORKSPACE_ID",
        required: false,
      },
    ],
    id: "emailbison",
    maturity: "unverified",
    name: "EmailBison",
    note: "Never run against a live account. Written from the public documentation and tested offline only.",
  },
  {
    channels: ["email", "linkedin"],
    docsUrl: null,
    envVars: [],
    id: "memory",
    maturity: "stable",
    name: "In-memory (tests and demos)",
    note: "Holds data in memory. For tests and demos; there is no vendor behind it.",
  },
] as const satisfies readonly ProviderInfo[];

/** The id of a provider in the catalog: `instantly`, `smartlead`, `heyreach`, `emailbison` or `memory`. */
export type ProviderId = (typeof CATALOG)[number]["id"];

export const providers: readonly ProviderInfo[] = CATALOG;

const IDS: ReadonlySet<string> = new Set(
  providers.map((provider) => provider.id)
);

/**
 * Whether a value is a provider id from the catalog, for checking a name that
 * arrives as a string from a flag or an environment variable. A provider
 * added to the catalog is accepted without a change here.
 *
 * ```ts
 * if (value === ALL_PROVIDERS || isProviderId(value)) {
 *   await fromEnv({ provider: value });
 * }
 * ```
 */
export const isProviderId = (value: unknown): value is ProviderId =>
  typeof value === "string" && IDS.has(value);

export const findProvider = (id: string): ProviderInfo | undefined =>
  providers.find((provider) => provider.id === id);

/** The variable `outbound-sdk/loader` reads to pick an adapter. */
export const PROVIDER_ENV = "OUTBOUND_SDK_PROVIDER";
