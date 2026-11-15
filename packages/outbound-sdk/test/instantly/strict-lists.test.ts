// A 200 that is not the documented list is the vendor's fault: a Provider
// error that says what was expected, never an empty page. Shapes are in
// docs/research/instantly.md, "Response shapes for list endpoints".

import assert from "node:assert/strict";
import { test } from "node:test";

import { OutboundError } from "../../src/index.ts";
import { harness } from "../helpers/adapter-suite.ts";
import { CAMPAIGN, suite } from "./suite.ts";

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
    new URL(request.url).pathname.endsWith(path) ? answer() : undefined;

test("instantly: a campaign list that is not an object with an items array is a Provider error", async () => {
  for (const answer of [
    html,
    () => Response.json({}),
    () => Response.json([]),
    () => Response.json({ items: null }),
  ]) {
    const { outbound, settle } = harness(suite, on("/campaigns", answer));

    // oxlint-disable-next-line no-await-in-loop -- one answer at a time, each on its own instance.
    await assert.rejects(
      async () => await settle(outbound.campaigns.list()),
      noList(
        /^Instantly returned no list for \/campaigns: expected a JSON object with an array in `items`$/u
      )
    );
  }
});

test("instantly: the documented empty list is zero campaigns", async () => {
  const { outbound, settle } = harness(
    suite,
    on("/campaigns", () => Response.json({ items: [] }))
  );

  const page = await settle(outbound.campaigns.list());

  assert.equal(page.items.length, 0);
  assert.equal(page.complete, true);
});

test("instantly: leads and emails read their lists strictly too", async () => {
  const leads = harness(
    suite,
    on("/leads/list", () => Response.json({}))
  );

  await assert.rejects(
    async () => await leads.settle(leads.outbound.leads.list()),
    noList(/no list for \/leads\/list/u)
  );

  const emails = harness(
    suite,
    on("/emails", () => Response.json({ items: null }))
  );

  await assert.rejects(
    async () => await emails.settle(emails.outbound.replies.list()),
    noList(/no list for \/emails/u)
  );
});

test("instantly: an analytics report that is not an array is a Provider error, and [] is no rows", async () => {
  const steps = harness(
    suite,
    on("/campaigns/analytics/steps", () => Response.json({}))
  );

  await assert.rejects(
    async () =>
      await steps.settle(
        steps.outbound.campaign(CAMPAIGN).stats({ scope: "step" })
      ),
    noList(
      /^Instantly returned no list for \/campaigns\/analytics\/steps: expected a JSON array$/u
    )
  );

  const empty = harness(
    suite,
    on("/campaigns/analytics/steps", () => Response.json([]))
  );

  const rows = await empty.settle(
    empty.outbound.campaign(CAMPAIGN).stats({ scope: "step" })
  );

  assert.equal(rows.rows.length, 0);
});
