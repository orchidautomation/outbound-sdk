// A real adapter with a made-up key and no network. `fetch` is replaced with
// one that answers from Instantly's documented payloads in the repository's
// fixtures/instantly/ folder. Those are not live responses.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import { createOutbound } from "outbound-sdk";
import { instantly } from "outbound-sdk/instantly";

const FIXTURES = new URL("../../../../fixtures/instantly/", import.meta.url);

const DOCUMENTED = new Map([
  ["/api/v2/campaigns", "listCampaigns.page2.json"],
  ["/api/v2/custom-tag-mappings", "listCustomTagMappings.json"],
  ["/api/v2/custom-tags", "listCustomTags.page2.json"],
]);

const paths: string[] = [];

const outbound = createOutbound({
  adapter: instantly({ apiKey: "example-key", workspaceId: "acme" }),
  fetch: (input, init) => {
    const { pathname } = new URL(new Request(input, init).url);
    const file = DOCUMENTED.get(pathname);

    paths.push(pathname);

    return Promise.resolve(
      file === undefined
        ? new Response("{}", { status: 404 })
        : new Response(readFileSync(new URL(file, FIXTURES), "utf-8"))
    );
  },
});

const page = await outbound.campaigns.list();

// The adapter's own mapping ran: Instantly's numeric status became a word.
assert.equal(page.items[0]?.name, "Third Campaign");

assert.equal(page.items[0]?.status, "paused");

console.log("ok - the documented payload maps to a Campaign");

// Unlike the in-memory adapter, this one counts requests.
assert.equal(page.meta.requests, paths.length);

console.log(`ok - ${page.meta.requests} requests:`, paths.join(", "));
