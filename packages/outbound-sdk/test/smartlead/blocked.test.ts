// Smartlead's BLOCKED means "bounced or on the block list" (OUT-106). The
// documentation read on 2026-11-16 gives no lead field that tells a
// never-sent block-listed lead from a bounce, so BLOCKED stays a bounce. Docs
// only: there is no live Smartlead key (OUT-10). See docs/research/smartlead.md.

import assert from "node:assert/strict";
import { test } from "node:test";

import { harness } from "../helpers/adapter-suite.ts";
import { fixture } from "../helpers/fixtures.ts";
import { CAMPAIGN, suite } from "./suite.ts";

test("smartlead: a BLOCKED lead with nothing sent is still a bounce, because the docs cannot tell it from one", async () => {
  const page = fixture("smartlead", "listCampaignLeads.json") as {
    data: Record<string, unknown>[];
  };

  const [row] = page.data;
  assert.ok(row);

  // The shape of the conflicting reference page (email_stats, last_sent_time),
  // with nothing sent and no bounce flagged.
  const { outbound, settle } = harness(suite, (request) =>
    /\/campaigns\/\d+\/leads$/u.test(new URL(request.url).pathname)
      ? Response.json({
          ...page,
          data: [
            {
              ...row,
              email_stats: { is_bounced: false },
              last_sent_time: null,
              status: "BLOCKED",
            },
          ],
          total_leads: 1,
        })
      : undefined
  );

  const leads = await settle(outbound.campaign(CAMPAIGN).leads.list());

  assert.deepEqual(
    leads.items.map((each) => [each.status, each.progress, each.bounced]),
    [["bounced", "unknown", true]],
    "never skipped: no documented field proves the lead was never sent to"
  );
});

test("smartlead: a campaign's progress has no skipped count, and the coverage says so", () => {
  const { outbound } = harness(suite);

  assert.equal(outbound.fields.campaignProgress.skipped, false);
  assert.equal(outbound.fields.campaignProgress.blocked, "exact");
});
