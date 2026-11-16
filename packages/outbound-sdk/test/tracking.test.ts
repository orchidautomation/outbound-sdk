// Opens and clicks a campaign did not measure are `null`, not 0 (OUT-89).
// Expected values come from the rule in `docs/api/stats`: a count is a number
// only when every campaign behind it measured it.

import assert from "node:assert/strict";
import { test } from "node:test";

import { computeRates } from "../src/index.ts";
import type { MetricRow } from "../src/index.ts";
import { suite as emailbison } from "./emailbison/suite.ts";
import { harness } from "./helpers/adapter-suite.ts";
import { fixture } from "./helpers/fixtures.ts";
import type { RecordedRequest } from "./helpers/http.ts";
import { ref, withRows } from "./insights/copy-helpers.ts";
import { NOW } from "./insights/helpers.ts";
import { CAMPAIGN, suite as instantly } from "./instantly/suite.ts";
import { suite as smartlead } from "./smartlead/suite.ts";

const OCTOBER = { from: "2026-10-01", to: "2026-10-31" };

const pathOf = (request: RecordedRequest): string =>
  new URL(request.url).pathname;

const tracked = (row: MetricRow | undefined) => ({
  clicked: row?.clicked,
  clickedTotal: row?.clickedTotal,
  opened: row?.opened,
  openedTotal: row?.openedTotal,
  tracking: row?.tracking,
});

const object = (provider: string, name: string): Record<string, unknown> =>
  fixture(provider, name) as Record<string, unknown>;

/** Instantly with one campaign's settings and its totals replaced. */
const instantlyWith = (
  settings: { open_tracking: boolean | null; link_tracking: boolean | null },
  totals: Record<string, number>
) =>
  harness(instantly, (request) => {
    const path = pathOf(request);

    if (path === `/api/v2/campaigns/${CAMPAIGN}`) {
      return Response.json({
        ...object("instantly", "getCampaign.json"),
        ...settings,
      });
    }

    return path === "/api/v2/campaigns/analytics/overview"
      ? Response.json({
          ...object("instantly", "getCampaignAnalyticsOverview.json"),
          ...totals,
        })
      : undefined;
  });

const NO_OPENS = { open_count: 0, open_count_unique: 0 };
const NO_CLICKS = { link_click_count: 0, link_click_count_unique: 0 };

test("tracking: open tracking off with no opens is null, with the reason on the row", async () => {
  const { outbound, requests, settle } = instantlyWith(
    { link_tracking: true, open_tracking: false },
    { ...NO_OPENS, link_click_count: 9, link_click_count_unique: 7 }
  );

  const { rows } = await settle(outbound.campaign(CAMPAIGN).stats(OCTOBER));

  assert.deepEqual(tracked(rows[0]), {
    clicked: 7,
    clickedTotal: 9,
    opened: null,
    openedTotal: null,
    tracking: { clicks: "on", opens: "off" },
  });
  assert.equal(
    rows[0] === undefined ? undefined : computeRates(rows[0]).openRate.value,
    null,
    "no 0% open rate for a campaign that did not track opens"
  );
  assert.deepEqual(requests.map(pathOf), [
    "/api/v2/campaigns/analytics/overview",
    `/api/v2/campaigns/${CAMPAIGN}`,
  ]);
});

test("tracking: link tracking off with no clicks is null, opens kept", async () => {
  const { outbound, settle } = instantlyWith(
    { link_tracking: false, open_tracking: true },
    { ...NO_CLICKS, ...NO_OPENS }
  );

  const { rows } = await settle(outbound.campaign(CAMPAIGN).stats(OCTOBER));

  assert.deepEqual(tracked(rows[0]), {
    clicked: null,
    clickedTotal: null,
    opened: 0,
    openedTotal: 0,
    tracking: { clicks: "off", opens: "on" },
  });
});

test("tracking: both on keeps a real 0", async () => {
  const { outbound, settle } = instantlyWith(
    { link_tracking: true, open_tracking: true },
    { ...NO_CLICKS, ...NO_OPENS }
  );

  const { rows } = await settle(outbound.campaign(CAMPAIGN).stats(OCTOBER));

  assert.deepEqual(tracked(rows[0]), {
    clicked: 0,
    clickedTotal: 0,
    opened: 0,
    openedTotal: 0,
    tracking: { clicks: "on", opens: "on" },
  });
});

test("tracking: tracking off now but opens in the range keeps the numbers", async () => {
  const { outbound, settle } = instantlyWith(
    { link_tracking: false, open_tracking: false },
    {}
  );

  const { rows } = await settle(outbound.campaign(CAMPAIGN).stats(OCTOBER));

  // The overview fixture has 800 opens and 800 clicks: they were recorded
  // while tracking was on, so they stand.
  assert.deepEqual(tracked(rows[0]), {
    clicked: 800,
    clickedTotal: 800,
    opened: 800,
    openedTotal: 800,
    tracking: { clicks: "off", opens: "off" },
  });
});

test("tracking: an unknown setting or a failed settings read keeps today's counts", async () => {
  const unknown = instantlyWith(
    { link_tracking: null, open_tracking: null },
    NO_OPENS
  );

  const [row] = (
    await unknown.settle(unknown.outbound.campaign(CAMPAIGN).stats(OCTOBER))
  ).rows;

  assert.equal(row?.opened, 0);
  assert.equal(row?.tracking, undefined, "set only when the adapter knows");

  const failed = harness(instantly, (request) =>
    pathOf(request) === `/api/v2/campaigns/${CAMPAIGN}`
      ? Response.json({ error: "Not Found" }, { status: 404 })
      : undefined
  );

  const [kept] = (
    await failed.settle(failed.outbound.campaign(CAMPAIGN).stats(OCTOBER))
  ).rows;

  assert.equal(kept?.opened, 800);
  assert.equal(kept?.tracking, undefined);
});

test("tracking: a daily series is judged once over the range, never mixing 0 and null", async () => {
  const days = [
    { date: "2026-10-01", opened: 0, sent: 10, unique_opened: 0 },
    { date: "2026-10-02", opened: 0, sent: 12, unique_opened: 0 },
  ];

  const { outbound, settle } = harness(instantly, (request) => {
    const path = pathOf(request);

    if (path === "/api/v2/campaigns/analytics/daily") {
      return Response.json(days);
    }

    return path === `/api/v2/campaigns/${CAMPAIGN}`
      ? Response.json({
          ...object("instantly", "getCampaign.json"),
          open_tracking: false,
        })
      : undefined;
  });

  const { rows } = await settle(
    outbound.campaign(CAMPAIGN).stats({ ...OCTOBER, by: "day" })
  );

  assert.deepEqual(
    rows.map((row) => [row.date, row.sent, row.opened, row.tracking?.opens]),
    [
      ["2026-10-01", 10, null, "off"],
      ["2026-10-02", 12, null, "off"],
    ]
  );
});

const A = "01a1d77f-0000-7000-8000-00000000000a";
const B = "01a1d77f-0000-7000-8000-00000000000b";
const C = "01a1d77f-0000-7000-8000-00000000000c";

/** An Instantly workspace whose campaigns have these settings. */
const workspace = (opens: Record<string, boolean>) =>
  harness(instantly, (request) => {
    const path = pathOf(request);

    if (path === "/api/v2/campaigns/analytics") {
      return Response.json([
        { campaign_id: A, emails_sent_count: 100, open_count_unique: 30 },
        { campaign_id: B, emails_sent_count: 50, open_count_unique: 0 },
        // Sent nothing in the range, so its settings do not count.
        { campaign_id: C, emails_sent_count: 0, open_count_unique: 0 },
      ]);
    }

    return path === "/api/v2/campaigns"
      ? Response.json({
          items: [A, B, C].map((id) => ({
            id,
            link_tracking: true,
            open_tracking: opens[id],
          })),
        })
      : undefined;
  });

test("tracking: a workspace with mixed open tracking reports no open count, not a partial sum", async () => {
  const { outbound, requests, settle } = workspace({
    [A]: true,
    [B]: false,
    [C]: false,
  });

  const [row] = (await settle(outbound.stats(OCTOBER))).rows;

  assert.equal(row?.opened, null);
  assert.equal(row?.openedTotal, null);
  assert.equal(row?.clicked, 800, "every campaign tracks clicks");
  assert.deepEqual(row?.tracking, { clicks: "on", opens: "mixed" });
  assert.deepEqual(requests.map(pathOf), [
    "/api/v2/campaigns/analytics/overview",
    "/api/v2/campaigns/analytics",
    "/api/v2/campaigns",
  ]);
});

test("tracking: a workspace where every sending campaign tracks keeps the vendor's numbers", async () => {
  const { outbound, settle } = workspace({ [A]: true, [B]: true, [C]: false });

  const [row] = (await settle(outbound.stats(OCTOBER))).rows;

  assert.equal(row?.opened, 800);
  assert.deepEqual(row?.tracking, { clicks: "on", opens: "on" });
});

test("tracking: every campaign's rows are each judged on their own settings", async () => {
  const { outbound, settle } = workspace({ [A]: false, [B]: false, [C]: true });

  const { rows } = await settle(
    outbound.stats({ ...OCTOBER, scope: "campaign" })
  );

  assert.deepEqual(
    rows.map((row) => [row.scopeRef, row.opened, row.tracking?.opens]),
    [
      // Off now, but 30 opens were recorded: they stand.
      [`instantly:client-a:${A}`, 30, "off"],
      [`instantly:client-a:${B}`, null, "off"],
      [`instantly:client-a:${C}`, 0, "on"],
    ]
  );
});

test("tracking: smartlead reads track_settings; off with no opens is null", async () => {
  const { outbound, settle } = harness(smartlead, (request) =>
    pathOf(request).endsWith("/analytics-by-date")
      ? Response.json({
          ...object("smartlead", "getCampaignAnalyticsByDate.json"),
          click_count: "4",
          open_count: "0",
          unique_click_count: "3",
          unique_open_count: "0",
        })
      : undefined
  );

  // The campaign fixture's track_settings is DONT_EMAIL_OPEN, DONT_LINK_CLICK.
  const [row] = (
    await settle(
      outbound.campaign("372").stats({ from: "2025-01-01", to: "2025-01-31" })
    )
  ).rows;

  assert.deepEqual(tracked(row), {
    clicked: 3,
    clickedTotal: 4,
    opened: null,
    openedTotal: null,
    tracking: { clicks: "off", opens: "off" },
  });
});

test("tracking: emailbison judges opens only; clicks are not a campaign setting", async () => {
  const { outbound, settle } = harness(emailbison, (request) =>
    pathOf(request) === "/api/campaigns/1/stats"
      ? Response.json({
          data: {
            ...(object("emailbison", "getCampaignStats.json").data as object),
            opened: "0",
            unique_opens_per_contact: "0",
          },
        })
      : undefined
  );

  // The campaign fixture has open_tracking false.
  const [row] = (await settle(outbound.campaign("1").stats(OCTOBER))).rows;

  assert.equal(row?.opened, null);
  assert.equal(row?.openedTotal, null);
  assert.deepEqual(row?.tracking, { clicks: null, opens: "off" });
});

test("tracking: a rollup with a row that did not measure opens has no open count, not the others' sum", async () => {
  const outbound = withRows({ campaigns: [{ id: "c1" }] }, [
    // One variant read as two rows: the second did not measure opens.
    {
      campaignId: "c1",
      counts: { opened: 100, sent: 500 },
      step: 0,
      variant: "A",
    },
    {
      campaignId: "c1",
      counts: { opened: null, sent: 500 },
      step: 0,
      variant: "A",
    },
    {
      campaignId: "c1",
      counts: { opened: 90, sent: 1000 },
      step: 0,
      variant: "B",
    },
  ]);

  const result = await outbound.insights.variantTest(
    { campaign: ref("c1"), metric: "opened" },
    { now: NOW }
  );

  const a = result.data.steps
    .find((step) => step.step === 0)
    ?.variants.find((variant) => variant.variantKey === "A");

  assert.equal(a?.sent, 1000);
  assert.equal(a?.count, null, "not 100 opens over 1,000 sends");
  assert.equal(a?.rate, null);
});
