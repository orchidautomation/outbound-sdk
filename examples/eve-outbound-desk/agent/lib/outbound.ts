// One outbound-sdk instance for the whole agency: an adapter per client,
// combined, so one rate budget and one cache cover every read the agent makes.
// The SDK only reads. Nothing here can send, pause, edit or delete anything.

import type { OutboundApi } from "outbound-sdk";

import { CLIENTS } from "./clients";
import type { Client } from "./clients";

// `OUTBOUND_SDK_PROVIDER=memory` serves made-up data (lib/demo.ts) with no
// vendor key, through the SDK's in-memory adapter.
const demo = process.env.OUTBOUND_SDK_PROVIDER === "memory";

const adapterFor = async (client: Client) => {
  if (demo) {
    const [{ memory }, { demoSeed }] = await Promise.all([
      import("outbound-sdk/memory"),
      import("./demo"),
    ]);

    return memory({ data: demoSeed(client.id), workspaceId: client.id });
  }

  const apiKey = process.env[client.apiKeyEnv];

  if (apiKey === undefined || apiKey === "") {
    throw new Error(
      `Set ${client.apiKeyEnv} to ${client.name}'s ${client.provider} API key, or set OUTBOUND_SDK_PROVIDER=memory for demo data.`
    );
  }

  const options = { apiKey, workspaceId: client.id };

  switch (client.provider) {
    case "instantly": {
      const { instantly } = await import("outbound-sdk/instantly");

      return instantly(options);
    }

    case "smartlead": {
      const { smartlead } = await import("outbound-sdk/smartlead");

      return smartlead(options);
    }

    case "heyreach": {
      const { heyreach } = await import("outbound-sdk/heyreach");

      return heyreach(options);
    }

    default: {
      throw new Error(`Unknown provider for ${client.name}`);
    }
  }
};

const build = async (): Promise<OutboundApi> => {
  const [{ createOutbound }, { combine }, { cache }] = await Promise.all([
    import("outbound-sdk"),
    import("outbound-sdk/combine"),
    import("outbound-sdk/cache"),
  ]);

  return createOutbound({
    adapter: combine(await Promise.all(CLIENTS.map(adapterFor))),
    // One tool call may spend at most this many vendor requests. A call that
    // would pass it fails with RateLimited instead of using up the quota.
    maxRequests: 150,
    // A thread asks follow-ups about the same numbers. Reuse them for five
    // minutes instead of reading the vendor again.
    plugins: [cache({ ttl: 300 })],
  });
};

let instance: Promise<OutboundApi> | undefined;

/** The agency's instance, built on first use and shared by every session. */
export const getOutbound = async (): Promise<OutboundApi> => {
  instance ??= build();

  try {
    return await instance;
  } catch (error) {
    // Build again on the next call, after the key is fixed.
    instance = undefined;
    throw error;
  }
};
