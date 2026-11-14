import { readFileSync } from "node:fs";

import { createOutbound } from "outbound-sdk";
import { heyreach } from "outbound-sdk/heyreach";

// Stands in for HeyReach: answers from the documented payloads in the
// repository's fixtures/heyreach/ folder. No request leaves the machine.
const fixture = (name: string): string =>
  readFileSync(
    new URL(`../../../../fixtures/heyreach/${name}.json`, import.meta.url),
    "utf-8"
  );

const sent: string[] = [];

const outbound = createOutbound({
  adapter: heyreach(),
  fetch: async (input, init) => {
    const request = new Request(input, init);
    const body = await request.text();

    sent.push(`${request.method} ${new URL(request.url).pathname} ${body}`);

    return new Response(
      fixture(
        body.includes('"offset":2')
          ? "getCampaignsForLead.page2"
          : "getCampaignsForLead"
      ),
      { headers: { "content-type": "application/json" } }
    );
  },
});

// Typed from the adapter: the name and its parameters autocomplete.
const first = await outbound.native.reads.campaignsForLead({
  limit: 2,
  profileUrl: "https://www.linkedin.com/in/example-person-1",
});

console.log(JSON.stringify(first.data, null, 2));

console.log("requests:", first.meta.requests, "evidence:", first.meta.evidence);

// One call is one request. Page with the vendor's own parameters, here
// HeyReach's offset and limit. `read` takes a name learned at run time.
const second = await outbound.native.read("campaignsForLead", {
  limit: 2,
  offset: 2,
  profileUrl: "https://www.linkedin.com/in/example-person-1",
});

console.log(JSON.stringify(second.data));

console.log(sent.join("\n"));
