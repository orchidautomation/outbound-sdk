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
  readonly envVars: readonly ProviderEnvVar[];
  /** The vendor's API documentation. */
  readonly docsUrl: string | null;
}

export const providers: readonly ProviderInfo[] = [
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
    maturity: "unverified",
    name: "Instantly",
  },
  {
    channels: ["email", "linkedin"],
    docsUrl: null,
    envVars: [],
    id: "memory",
    maturity: "stable",
    name: "In-memory (tests and demos)",
  },
];

export const findProvider = (id: string): ProviderInfo | undefined =>
  providers.find((provider) => provider.id === id);

/** The variable `outbound-sdk/loader` reads to pick an adapter. */
export const PROVIDER_ENV = "OUTBOUND_SDK_PROVIDER";
