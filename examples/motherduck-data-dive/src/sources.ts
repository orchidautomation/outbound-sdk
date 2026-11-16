// Which workspaces to read: every tool whose API key is set, or the made-up
// demo agency with `--demo` or when no key is set.

import { createOutbound } from "outbound-sdk";
import type { Adapter } from "outbound-sdk";
import { exporter } from "outbound-sdk/exporter";
import { memory } from "outbound-sdk/memory";

import { demoWorkspaces } from "./demo.ts";

const KEYS = [
  ["instantly", "INSTANTLY_API_KEY"],
  ["smartlead", "SMARTLEAD_API_KEY"],
  ["heyreach", "HEYREACH_API_KEY"],
  ["emailbison", "EMAILBISON_API_KEY"],
] as const;

const liveAdapter = async (
  provider: (typeof KEYS)[number][0]
): Promise<Adapter> => {
  // Each adapter reads its own key and workspace label from the environment.
  switch (provider) {
    case "instantly": {
      const { instantly } = await import("outbound-sdk/instantly");

      return instantly();
    }

    case "smartlead": {
      const { smartlead } = await import("outbound-sdk/smartlead");

      return smartlead();
    }

    case "heyreach": {
      const { heyreach } = await import("outbound-sdk/heyreach");

      return heyreach();
    }

    case "emailbison": {
      const { emailbison } = await import("outbound-sdk/emailbison");

      return emailbison();
    }

    default: {
      const unreachable: never = provider;

      return unreachable;
    }
  }
};

const open = (adapter: Adapter) =>
  createOutbound({ adapter, plugins: [exporter()] });

export type Source = ReturnType<typeof open>;

export interface Sources {
  readonly demo: boolean;
  readonly sources: readonly Source[];
}

export const pickSources = async (forceDemo: boolean): Promise<Sources> => {
  const live = KEYS.filter(([, env]) => (process.env[env] ?? "") !== "");

  if (forceDemo || live.length === 0) {
    return {
      demo: true,
      sources: demoWorkspaces().map((workspace) =>
        open(
          memory({
            data: workspace.data,
            name: workspace.provider,
            workspaceId: workspace.workspaceId,
          })
        )
      ),
    };
  }

  const adapters = await Promise.all(
    live.map(([provider]) => liveAdapter(provider))
  );

  return { demo: false, sources: adapters.map((adapter) => open(adapter)) };
};
