// A 200 that is not the documented list is the vendor's fault: a Provider
// error that says what was expected, never an empty page. Shapes are in
// docs/research/heyreach.md, "Response shapes for list endpoints".

import assert from "node:assert/strict";
import { test } from "node:test";

import { OutboundError } from "../../src/index.ts";
import { harness } from "../helpers/adapter-suite.ts";
import { LEAD, suite } from "./suite.ts";

const html = () =>
  new Response("<html><body>Down for maintenance</body></html>", {
    headers: { "content-type": "text/html" },
  });

const noList = (expected: RegExp) => (error: unknown) =>
  OutboundError.is(error) &&
  error.code === "Provider" &&
  expected.test(error.message);

const on =
  (path: string, answer: () => Response) =>
  (request: { readonly url: string }) =>
    new URL(request.url).pathname === `/api/public${path}`
      ? answer()
      : undefined;

test("heyreach: a campaign list that is not an object with an items array is a Provider error", async () => {
  for (const answer of [
    html,
    () => Response.json({}),
    () => Response.json([]),
    () => Response.json({ items: null, totalCount: 0 }),
  ]) {
    const { outbound, settle } = harness(suite, on("/campaign/GetAll", answer));

    // oxlint-disable-next-line no-await-in-loop -- one answer at a time, each on its own instance.
    await assert.rejects(
      async () => await settle(outbound.campaigns.list()),
      noList(
        /^HeyReach returned no list for \/campaign\/GetAll: expected a JSON object with an array in `items`$/u
      )
    );
  }
});

test("heyreach: the documented empty list is zero campaigns", async () => {
  const { outbound, settle } = harness(
    suite,
    on("/campaign/GetAll", () => Response.json({ items: [], totalCount: 0 }))
  );

  const page = await settle(outbound.campaigns.list());

  assert.equal(page.items.length, 0);
  assert.equal(page.complete, true);
});

test("heyreach: conversations read their list strictly", async () => {
  const { outbound, settle } = harness(
    suite,
    on("/inbox/GetConversationsV3", () => Response.json({}))
  );

  await assert.rejects(
    async () => await settle(outbound.messages.list()),
    noList(/no list for \/inbox\/GetConversationsV3/u)
  );
});

test("heyreach: a lookup answered with a bad campaigns list is an error, unlike its 404", async () => {
  const { outbound, settle } = harness(
    suite,
    on("/campaign/GetCampaignsForLead", () => Response.json({ items: null }))
  );

  await assert.rejects(
    async () => await settle(outbound.leads.list({ linkedinUrl: LEAD })),
    noList(/no list for \/campaign\/GetCampaignsForLead/u)
  );
});

test("heyreach: GetTags stays lenient, except for a body that is not JSON", async () => {
  const empty = harness(
    suite,
    on("/lead/GetTags", () => Response.json({}))
  );

  assert.deepEqual(
    (await empty.settle(empty.outbound.leads.get(LEAD))).tags,
    []
  );

  const broken = harness(suite, on("/lead/GetTags", html));

  await assert.rejects(
    async () => await broken.settle(broken.outbound.leads.get(LEAD)),
    noList(/no JSON for \/lead\/GetTags/u)
  );
});
