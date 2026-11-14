// Two real Instantly adapters with made-up keys and no network: `fetch` is
// replaced with one that answers from Instantly's documented payloads in the
// repository's fixtures/instantly/ folder. Those are not live responses.
import { readFileSync } from "node:fs";

import { createOutbound } from "outbound-sdk";
import { combine } from "outbound-sdk/combine";
import { instantly } from "outbound-sdk/instantly";

const FIXTURES = new URL("../../../../fixtures/instantly/", import.meta.url);

const DOCUMENTED = new Map([
  ["/api/v2/campaigns", "listCampaigns.page2.json"],
  ["/api/v2/custom-tag-mappings", "listCustomTagMappings.json"],
  ["/api/v2/custom-tags", "listCustomTags.page2.json"],
]);

const keysUsed: string[] = [];

const documented: typeof fetch = (input, init) => {
  const request = new Request(input, init);
  const file = DOCUMENTED.get(new URL(request.url).pathname);

  keysUsed.push(request.headers.get("authorization") ?? "none");

  return Promise.resolve(
    file === undefined
      ? new Response("{}", { status: 404 })
      : new Response(readFileSync(new URL(file, FIXTURES), "utf-8"))
  );
};

const outbound = createOutbound({
  adapter: combine([
    instantly({ apiKey: "example-key-acme", workspaceId: "acme" }),
    instantly({ apiKey: "example-key-globex", workspaceId: "globex" }),
  ]),
  fetch: documented,
});

// One listing across both clients, then one more read for acme alone.
await outbound.campaigns.listAll().toArray();

await outbound.workspace("acme").campaigns.list();

for (const snapshot of await outbound.limits()) {
  const [perSecond, perMinute] = snapshot.windows;

  console.log(
    `${snapshot.workspaceId}: used ${perMinute?.used} of ${perMinute?.requests} a minute, ${perSecond?.requests} a second allowed`
  );
}

console.log("keys used:", [...new Set(keysUsed)]);
