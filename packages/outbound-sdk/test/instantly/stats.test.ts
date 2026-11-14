import assert from "node:assert/strict";
import { test } from "node:test";

import { OutboundError } from "../../src/index.ts";
import { harness } from "../helpers/adapter-suite.ts";
import { fixture } from "../helpers/fixtures.ts";
import { CAMPAIGN, suite } from "./suite.ts";

test("instantly: bodies are left out unless asked for", async () => {
  const { outbound, settle } = harness(suite);
  const page = await settle(outbound.messages.list());
  assert.equal(page.items[0]?.bodyText, null);
  assert.equal(page.items[0]?.bodyHtml, null);
});

test("instantly: campaign totals come from the overview, with interested leads as positive", async () => {
  const { outbound, requests, settle } = harness(suite);

  const stats = await settle(
    outbound.campaign(CAMPAIGN).stats({ from: "2026-10-01", to: "2026-10-31" })
  );

  const url = new URL(requests[0]?.url ?? "");
  assert.equal(url.pathname, "/api/v2/campaigns/analytics/overview");
  assert.equal(url.searchParams.get("id"), CAMPAIGN);
  assert.equal(url.searchParams.get("start_date"), "2026-10-01");
  assert.equal(url.searchParams.get("end_date"), "2026-10-31");
  const [row] = stats.rows;
  assert.equal(row?.scope, "campaign");
  assert.equal(row?.scopeRef, `instantly:client-a:${CAMPAIGN}`);
  assert.equal(row?.sent, 5000);
  assert.equal(row?.contacted, 4500);
  assert.equal(row?.opened, 800);
  assert.equal(row?.replied, 300);
  assert.equal(row?.repliedAuto, 45);
  assert.equal(row?.positive, 103);
  assert.equal(row?.bounced, 50);
  assert.equal(row?.unsubscribed, 20);
  assert.equal(row?.delivered, null, "Instantly reports no delivered count");
  assert.equal(row?.evidence, "exact");
});

test("instantly: daily and step analytics keep their own counts", async () => {
  const { outbound, settle } = harness(suite);
  const daily = await settle(outbound.stats({ by: "day" }));
  assert.equal(daily.rows[0]?.date, "2025-03-01");
  assert.equal(daily.rows[0]?.sent, 5421);
  assert.equal(daily.rows[0]?.opened, 60, "unique_opened");
  assert.equal(daily.rows[0]?.openedTotal, 99);
  assert.equal(daily.rows[0]?.replied, 60);
  assert.equal(daily.rows[0]?.repliedAuto, 4);
  assert.equal(daily.rows[0]?.positive, null);
  assert.equal(daily.rows[0]?.timezone, null);

  const steps = await settle(
    outbound.campaign(CAMPAIGN).stats({ scope: "step" })
  );

  assert.equal(steps.rows[0]?.stepIndex, 0, 'step "0" is the first step');
  assert.deepEqual(
    steps.rows.map((row) => [row.stepIndex, row.variantKey, row.sent]),
    [
      [0, "A", 5421],
      [3, "B", 5422],
      [null, null, 7],
    ],
    "steps and variants count from 0; a row with no step keeps its counts"
  );
  assert.equal(
    steps.rows[0]?.variantKey,
    "A",
    'variant "0" is the first variant'
  );
  assert.equal(steps.rows[0]?.sent, 5421);
});

test("instantly: a mailbox total is summed from daily rows and marked derived", async () => {
  const { outbound, requests, settle } = harness(suite);
  const total = await settle(outbound.sender("person1@example.com").stats());
  assert.equal(
    new URL(requests[0]?.url ?? "").searchParams.get("emails"),
    "person1@example.com"
  );

  const days = fixture("instantly", "getAccountDailyAnalytics.json") as {
    sent: number;
    bounced: number;
  }[];

  assert.equal(total.rows.length, 1);
  assert.equal(
    total.rows[0]?.sent,
    days.reduce((sum, day) => sum + day.sent, 0)
  );
  assert.equal(
    total.rows[0]?.bounced,
    days.reduce((sum, day) => sum + day.bounced, 0)
  );
  assert.equal(total.rows[0]?.evidence, "derived");
  assert.equal(total.meta.evidence, "derived");

  const daily = await settle(
    outbound.sender("person1@example.com").stats({ by: "day" })
  );

  assert.equal(daily.rows[0]?.date, "2024-01-15");
  assert.equal(daily.rows[0]?.evidence, "exact");
});

test("instantly: step analytics by day are refused", async () => {
  const { outbound, settle } = harness(suite);
  await assert.rejects(
    async () =>
      await settle(
        outbound.campaign(CAMPAIGN).stats({ by: "day", scope: "step" })
      ),
    (error) => OutboundError.is(error) && error.code === "Unsupported"
  );
});

test("instantly: each overview count is read from its own field", async () => {
  const overview = {
    bounced_count: 11,
    completed_count: 12,
    contacted_count: 13,
    emails_sent_count: 14,
    link_click_count: 15,
    link_click_count_unique: 16,
    link_click_count_unique_by_step: 17,
    new_leads_contacted_count: 18,
    open_count: 19,
    open_count_unique: 20,
    open_count_unique_by_step: 21,
    reply_count: 22,
    reply_count_automatic: 23,
    reply_count_automatic_unique: 24,
    reply_count_automatic_unique_by_step: 25,
    reply_count_unique: 26,
    reply_count_unique_by_step: 27,
    total_closed: 28,
    total_interested: 29,
    total_meeting_booked: 30,
    total_meeting_completed: 31,
    total_opportunities: 32,
    unsubscribed_count: 33,
  };

  const { outbound, settle } = harness(suite, () => Response.json(overview));
  const [row] = (await settle(outbound.stats())).rows;
  assert.deepEqual(
    {
      bounced: row?.bounced,
      clicked: row?.clicked,
      contacted: row?.contacted,
      opened: row?.opened,
      openedTotal: row?.openedTotal,
      positive: row?.positive,
      replied: row?.replied,
      repliedAuto: row?.repliedAuto,
      sent: row?.sent,
      unsubscribed: row?.unsubscribed,
    },
    {
      bounced: 11,
      clicked: 16,
      contacted: 13,
      opened: 20,
      openedTotal: 19,
      positive: 29,
      replied: 26,
      repliedAuto: 24,
      sent: 14,
      unsubscribed: 33,
    }
  );
  assert.equal(row?.scope, "workspace");
});

test("instantly: each daily count is read from its own field", async () => {
  const day = {
    bounced: 41,
    clicks: 42,
    contacted: 43,
    date: "2026-10-05",
    new_leads_contacted: 44,
    opened: 45,
    opportunities: 46,
    replies: 47,
    replies_automatic: 48,
    sent: 49,
    unique_clicks: 50,
    unique_opened: 51,
    unique_opportunities: 52,
    unique_replies: 53,
    unique_replies_automatic: 54,
  };

  const { outbound, settle } = harness(suite, () => Response.json([day]));
  const [row] = (await settle(outbound.stats({ by: "day" }))).rows;
  assert.deepEqual(
    {
      bounced: row?.bounced,
      clicked: row?.clicked,
      contacted: row?.contacted,
      date: row?.date,
      opened: row?.opened,
      openedTotal: row?.openedTotal,
      replied: row?.replied,
      repliedAuto: row?.repliedAuto,
      sent: row?.sent,
    },
    {
      bounced: 41,
      clicked: 50,
      contacted: 43,
      date: "2026-10-05",
      opened: 51,
      openedTotal: 45,
      replied: 53,
      repliedAuto: 54,
      sent: 49,
    }
  );
});
