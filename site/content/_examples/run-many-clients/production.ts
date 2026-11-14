import { createOutbound } from "outbound-sdk";
import { clients } from "outbound-sdk/clients";
import { combine } from "outbound-sdk/combine";
import { heyreach } from "outbound-sdk/heyreach";
import { instantly } from "outbound-sdk/instantly";

// Your own list of clients and the variable each key is kept in.
const CLIENTS = [
  {
    heyreach: "ACME_HEYREACH_KEY",
    id: "acme",
    instantly: "ACME_INSTANTLY_KEY",
  },
  { id: "globex", instantly: "GLOBEX_INSTANTLY_KEY" },
];

// Always pass `apiKey`. An adapter given none falls back to its vendor's own
// variable (INSTANTLY_API_KEY), which would be some other client's key.
const key = (name: string): string => {
  const value = process.env[name];

  if (value === undefined || value === "") {
    throw new Error(`${name} is not set`);
  }

  return value;
};

/** Built on first use, so a missing key fails the call and not the import. */
export const createAgency = () =>
  createOutbound({
    adapter: combine(
      CLIENTS.flatMap((client) => [
        instantly({ apiKey: key(client.instantly), workspaceId: client.id }),
        ...(client.heyreach === undefined
          ? []
          : [
              heyreach({
                apiKey: key(client.heyreach),
                workspaceId: client.id,
              }),
            ]),
      ])
    ),
    plugins: [clients()],
  });
