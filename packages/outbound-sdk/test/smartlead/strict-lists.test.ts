// A 200 that is not the documented list is the vendor's fault: a Provider
// error that says what was expected, never an empty page. Shapes are in
// docs/research/smartlead.md, "Response shapes for list endpoints".

import assert from "node:assert/strict";
import { test } from "node:test";

import { OutboundError } from "../../src/index.ts";
import { harness } from "../helpers/adapter-suite.ts";
import { fixture } from "../helpers/fixtures.ts";
import { API, CAMPAIGN, LEAD, suite } from "./suite.ts";

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
    new URL(request.url).pathname === `${API}${path}` ? answer() : undefined;

test("smartlead: a campaign list that is not an array is a Provider error", async () => {
  for (const answer of [
    html,
    () => Response.json({}),
    () => Response.json({ items: [] }),
    () => Response.json({ ok: true, data: null }),
  ]) {
    const { outbound, settle } = harness(suite, on("/campaigns/", answer));

    // oxlint-disable-next-line no-await-in-loop -- one answer at a time, each on its own instance.
    await assert.rejects(
      async () => await settle(outbound.campaigns.list()),
      noList(/^Smartlead returned no list for \/campaigns\/: expected a JSON/u)
    );
  }
});

test("smartlead: the documented campaign lists read, and [] is zero campaigns", async () => {
  const rows = fixture("smartlead", "listCampaigns.json");

  for (const [body, expected] of [
    [[], 0],
    [{ ok: true, data: [] }, 0],
    [{ campaigns: rows }, (rows as unknown[]).length],
  ] as const) {
    const { outbound, settle } = harness(
      suite,
      on("/campaigns/", () => Response.json(body))
    );

    // oxlint-disable-next-line no-await-in-loop -- one answer at a time, each on its own instance.
    const page = await settle(outbound.campaigns.list());

    assert.equal(page.items.length, expected, JSON.stringify(body));
    assert.equal(page.complete, true);
  }
});

test("smartlead: a campaign's leads need their data array", async () => {
  for (const body of [{ data: null, total_leads: "0" }, {}]) {
    const { outbound, settle } = harness(
      suite,
      on(`/campaigns/${CAMPAIGN}/leads`, () => Response.json(body))
    );

    // oxlint-disable-next-line no-await-in-loop -- one answer at a time, each on its own instance.
    await assert.rejects(
      async () => await settle(outbound.campaign(CAMPAIGN).leads.list()),
      noList(
        new RegExp(
          `^Smartlead returned no list for /campaigns/${CAMPAIGN}/leads: expected a JSON object with an array in \`data\`$`,
          "u"
        )
      )
    );
  }

  const { outbound, settle } = harness(
    suite,
    on(`/campaigns/${CAMPAIGN}/leads`, () =>
      Response.json({ data: [], limit: 100, offset: 0, total_leads: "0" })
    )
  );

  const page = await settle(outbound.campaign(CAMPAIGN).leads.list());

  assert.equal(page.items.length, 0);
  assert.equal(page.complete, true);
});

test("smartlead: replies and senders read their lists strictly", async () => {
  const replies = harness(
    suite,
    on("/master-inbox/inbox-replies", () => Response.json({}))
  );

  await assert.rejects(
    async () => await replies.settle(replies.outbound.replies.list()),
    noList(/no list for \/master-inbox\/inbox-replies/u)
  );

  const none = harness(
    suite,
    on("/master-inbox/inbox-replies", () =>
      Response.json({ messages: [], total_count: 0 })
    )
  );

  assert.equal(
    (await none.settle(none.outbound.replies.list())).items.length,
    0
  );

  const senders = harness(
    suite,
    on("/email-accounts/", () => Response.json({}))
  );

  await assert.rejects(
    async () => await senders.settle(senders.outbound.senders.list()),
    noList(/no list for \/email-accounts\//u)
  );
});

test("smartlead: the lenient reads stay lenient, but not for a body that is not JSON", async () => {
  // `{}` with 200 is the documented answer for an unknown address.
  const unknown = harness(
    suite,
    on("/leads/", () => Response.json({}))
  );

  assert.equal(
    (
      await unknown.settle(
        unknown.outbound.leads.list({ email: "nobody@example.com" })
      )
    ).items.length,
    0
  );

  const broken = harness(suite, on("/leads/", html));

  await assert.rejects(
    async () =>
      await broken.settle(
        broken.outbound.leads.list({ email: "nobody@example.com" })
      ),
    noList(/no object for \/leads\/\?email=/u)
  );

  // `GET /leads/{id}/campaigns` is in the legacy docs only: JSON that is no
  // array is still no campaigns, and HTML is still an error.
  const legacy = harness(
    suite,
    on(`/leads/${LEAD}/campaigns`, () => Response.json({}))
  );

  assert.equal(
    (await legacy.settle(legacy.outbound.messages.list({ leadId: LEAD }))).items
      .length,
    0
  );

  const legacyHtml = harness(suite, on(`/leads/${LEAD}/campaigns`, html));

  await assert.rejects(
    async () =>
      await legacyHtml.settle(
        legacyHtml.outbound.messages.list({ leadId: LEAD })
      ),
    noList(/no JSON for \/leads\/789\/campaigns/u)
  );
});
