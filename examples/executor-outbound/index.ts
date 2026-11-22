// An Executor app that offers outbound-sdk's read-only tools over Instantly,
// Smartlead, HeyReach and EmailBison. Executor keeps each API key. This code
// gets a handle in its place, and Executor's network swaps the real key in
// only on a request to that vendor's host, in the one spot declared below.

import {
  bearer,
  defineApp,
  defineProvider,
  header,
  jsonSchema,
  object,
  plain,
  query,
  router,
  secrets,
  string,
} from "apps";
import type { QueryContext } from "apps";
import type { OutboundTool } from "outbound-sdk/tools";

import { outboundFor, toolsFor } from "./outbound.ts";

const keyField = string({
  description: "The vendor API key. A read-only key is enough.",
  minLength: 1,
});

const client = plain(
  string({
    description:
      "Your own label for the client this key belongs to, such as acme. Every record carries it as its workspaceId.",
  })
).optional();

const instantly = defineProvider({
  name: "Instantly",
  hosts: ["api.instantly.ai"],
  auth: {
    apiKey: secrets({
      label: "API key",
      guide: "An Instantly API v2 key. The `all:read` scope is enough.",
      fields: object({ apiKey: keyField, client }),
      request: ({ apiKey }) => bearer(apiKey),
    }),
  },
});

const smartlead = defineProvider({
  name: "Smartlead",
  hosts: ["server.smartlead.ai"],
  auth: {
    apiKey: secrets({
      label: "API key",
      guide: "Your Smartlead API key.",
      fields: object({ apiKey: keyField, client }),
      // Smartlead takes its key as the api_key query parameter.
      request: ({ apiKey }) => ({
        in: "query",
        name: "api_key",
        value: [{ field: apiKey.field }],
      }),
    }),
  },
});

const heyreach = defineProvider({
  name: "HeyReach",
  hosts: ["api.heyreach.io"],
  auth: {
    apiKey: secrets({
      label: "API key",
      guide: "Your HeyReach API key.",
      fields: object({ apiKey: keyField, client }),
      request: ({ apiKey }) => header("x-api-key", apiKey),
    }),
  },
});

const emailbison = defineProvider({
  name: "EmailBison",
  // Each customer has their own EmailBison URL. Add yours here if it is not
  // under emailbison.com, then reconnect the account.
  hosts: ["*.emailbison.com"],
  auth: {
    apiKey: secrets({
      label: "API key",
      guide:
        "Your EmailBison API key. **Base URL** is the address you log in to, such as https://send.example.com.",
      fields: object({
        apiKey: keyField,
        baseUrl: plain(
          string({
            description: "The URL you log in to EmailBison with.",
            minLength: 1,
          })
        ),
        client,
      }),
      request: ({ apiKey }) => bearer(apiKey),
    }),
  },
});

// Each list may be empty: link only the tools you use, and any number of
// client workspaces on each.
const requirements = {
  user: {
    accounts: {
      instantly: instantly.many(),
      smartlead: smartlead.many(),
      heyreach: heyreach.many(),
      emailbison: emailbison.many(),
    },
  },
};

type Context = QueryContext<typeof requirements>;

// The list of tools is the same for every caller, so it comes from an
// instance over keys that are never sent: constructing an adapter makes no
// request. It is built inside defineApp's factory, because redact() draws a
// random key and Workers allow that only inside a handler.
const placeholder = [
  {
    id: "catalog",
    fields: { apiKey: "unused", baseUrl: "https://dedi.emailbison.com" },
  },
];

const catalogInstance = () =>
  outboundFor(
    {
      emailbison: placeholder,
      heyreach: placeholder,
      instantly: placeholder,
      smartlead: placeholder,
    },
    () => Promise.reject(new Error("the catalog sends no request"))
  );

const catalog = async (): Promise<OutboundTool[]> => {
  const instance = catalogInstance();

  return instance === undefined ? [] : await toolsFor(instance);
};

const NOTHING_LINKED = {
  error: {
    code: "Unauthorized",
    message:
      "No Instantly, Smartlead, HeyReach or EmailBison account is linked to this app.",
    retryable: false,
  },
  next: "Link an account on the app's Accounts tab in Executor, then call the tool again.",
  ok: false,
} as const;

// One Executor query per outbound-sdk tool. Each call builds an instance
// from the caller's own linked accounts and sends through ctx.fetch.
const toolsOf = (listedTools: readonly OutboundTool[]) =>
  Object.fromEntries(
    listedTools.map((listed) => [
      listed.name,
      query(
        {
          description: listed.description,
          input: jsonSchema(listed.parameters),
        },
        async (ctx: Context, input) => {
          const outbound = outboundFor(ctx.user.accounts, ctx.fetch);

          if (outbound === undefined) {
            return NOTHING_LINKED;
          }

          const offered = await toolsFor(outbound);

          const tool = offered.find(
            (candidate) => candidate.name === listed.name
          );

          if (tool === undefined) {
            return {
              error: {
                code: "Unsupported",
                message: `${listed.name} needs a read none of your linked accounts offers.`,
                retryable: false,
              },
              next: "Call another tool, or link an account on a tool that offers this read.",
              ok: false,
            };
          }

          return await tool.call(input);
        }
      ),
    ])
  );

export default defineApp(requirements, async () => ({
  tools: router(toolsOf(await catalog())),
}));
