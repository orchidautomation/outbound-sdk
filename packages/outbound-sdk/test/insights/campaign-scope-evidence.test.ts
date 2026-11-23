// A campaign scope matched on our side, over a campaign listing read whole,
// is a fixed rule over exact records, so the answer stays exact (OUT-205).
// The note still says the filter ran here. A listing that could not be read
// whole gives no answer at all, and a derived read elsewhere still counts.

import assert from "node:assert/strict";
import { test } from "node:test";

import { createOutbound, OutboundError } from "../../src/index.ts";
import { insights } from "../../src/insights/index.ts";
import { demoData, memory } from "../../src/memory/index.ts";
import { NOW, over, settled, world } from "./metered.ts";

const demo = () =>
  createOutbound({
    adapter: memory({ data: demoData({ now: NOW }) }),
    plugins: [insights()],
  });

test("a tag or name matched here over a whole listing keeps the answer exact", async () => {
  const outbound = demo();

  assert.equal(outbound.capabilities["campaigns.byTag"], "client");

  for (const scope of [
    { tag: "client-a" },
    { campaign_name: "Q4*" },
    { campaign_name: "/q4 saas founders/i" },
  ]) {
    const report = await outbound.insights.clientReport(
      { days: 7, ...scope },
      { now: NOW }
    );

    assert.equal(report.meta.evidence, "exact", JSON.stringify(scope));
    assert.equal(report.meta.complete, true);
    assert.match(
      report.meta.notes.join(" "),
      /1 campaign of memory:default match\. .*listing was read and filtered here/u
    );
  }
});

test("a request cap the scope listing cannot fit in gives no answer, not a partial exact one", async () => {
  // Thirty campaigns are three pages of ten, more than a cap of two.
  const { http, outbound } = over(world(30, 1));

  const result = await settled(
    outbound.insights.campaignRanking(
      { statuses: ["active", "paused", "completed"], tag: "even" },
      { maxRequests: 2, now: NOW }
    )
  );

  assert.ok(
    "rejected" in result &&
      OutboundError.is(result.rejected) &&
      result.rejected.code === "RateLimited",
    JSON.stringify(result)
  );
  assert.equal(http.requests.length, 0);
});

test("a scoped answer with a derived figure behind it stays derived", async () => {
  // Agency owners' period reports no sends, so its reply rate divides by leads contacted.
  const report = await demo().insights.clientReport(
    { campaign_name: "Agency owners", days: 7 },
    { now: NOW }
  );

  assert.equal(report.meta.evidence, "derived");
  assert.match(report.meta.notes.join(" "), /filtered here/u);
});
