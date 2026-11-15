import assert from "node:assert/strict";
import { test } from "node:test";

import { OutboundError } from "../../src/index.ts";
import { harness } from "../helpers/adapter-suite.ts";
import { json } from "../helpers/http.ts";
import { CAMPAIGN, SENDER, suite } from "./suite.ts";

const urlOf = (request: { url: string } | undefined): URL =>
  new URL(request?.url ?? "");

const COUNTS = [
  "sent",
  "contacted",
  "opened",
  "openedTotal",
  "replied",
  "bounced",
  "unsubscribed",
  "positive",
  "clicked",
  "delivered",
] as const;

const countsOf = (row: Record<string, unknown> | undefined) =>
  Object.fromEntries(COUNTS.map((key) => [key, row?.[key]]));

test("emailbison: workspace totals read the summary's string counts, never its percentages", async () => {
  const { outbound, requests, settle } = harness(suite);

  const { rows } = await settle(
    outbound.stats({ from: "2025-11-01", to: "2025-11-30" })
  );

  assert.equal(rows.length, 1);
  assert.deepEqual(countsOf(rows[0]), {
    bounced: 21,
    clicked: null,
    contacted: 640,
    delivered: null,
    opened: 300,
    openedTotal: 410,
    positive: 17,
    replied: 48,
    sent: 1200,
    unsubscribed: 9,
  });
  assert.equal(rows[0]?.scopeRef, "emailbison:client-a:client-a");
  const url = urlOf(requests[0]);
  assert.equal(url.pathname, "/api/workspaces/v1.1/stats");
  assert.equal(url.searchParams.get("start_date"), "2025-11-01");
  assert.equal(url.searchParams.get("end_date"), "2025-11-30");
});

test("emailbison: a total without dates asks for 2000-01-01 to today", async () => {
  const { outbound, requests, settle } = harness(suite);
  await settle(outbound.stats());
  const url = urlOf(requests[0]);
  assert.equal(url.searchParams.get("start_date"), "2000-01-01");
  assert.match(url.searchParams.get("end_date") ?? "", /^\d{4}-\d{2}-\d{2}$/u);
});

test("emailbison: a campaign's totals are a POST read with the dates in the body", async () => {
  const { outbound, requests, settle } = harness(suite);

  const { rows } = await settle(
    outbound.campaign(CAMPAIGN).stats({ from: "2025-11-01", to: "2025-11-30" })
  );

  assert.deepEqual(countsOf(rows[0]), {
    bounced: 2,
    clicked: null,
    contacted: 40,
    delivered: null,
    opened: 9,
    openedTotal: 12,
    positive: 3,
    replied: 5,
    sent: 70,
    unsubscribed: 1,
  });
  assert.equal(requests[0]?.method, "POST");
  assert.equal(urlOf(requests[0]).pathname, "/api/campaigns/1/stats");
  assert.deepEqual(JSON.parse(requests[0]?.body ?? "{}"), {
    end_date: "2025-11-30",
    start_date: "2025-11-01",
  });
});

test("emailbison: daily rows come from the line-area series, one row per day", async () => {
  const { outbound, requests, settle } = harness(suite);

  const { rows } = await settle(
    outbound.stats({ by: "day", from: "2025-11-24", to: "2025-11-26" })
  );

  assert.deepEqual(
    rows.map((row) => [
      row.date,
      row.sent,
      row.replied,
      row.openedTotal,
      row.opened,
      row.bounced,
      row.unsubscribed,
      row.positive,
      row.timezone,
    ]),
    [
      ["2025-11-24", 20, 1, 5, 4, 2, 0, 1, null],
      ["2025-11-25", 21, 2, 6, 5, 3, 1, 2, null],
      ["2025-11-26", 22, 3, 7, 6, 4, 2, 3, null],
    ]
  );
  assert.equal(
    urlOf(requests[0]).pathname,
    "/api/workspaces/v1.1/line-area-chart-stats"
  );
});

test("emailbison: a campaign's daily rows read its own series, 30 days back by default", async () => {
  const { outbound, requests, settle } = harness(suite);

  const { rows } = await settle(
    outbound.campaign(CAMPAIGN).stats({ by: "day", to: "2025-11-30" })
  );

  assert.deepEqual(
    rows.map((row) => row.date),
    ["2025-11-24", "2025-11-25"]
  );
  const url = urlOf(requests[0]);
  assert.equal(url.pathname, "/api/campaigns/1/line-area-chart-stats");
  assert.equal(url.searchParams.get("start_date"), "2025-10-31");
  assert.equal(url.searchParams.get("end_date"), "2025-11-30");
});

test("emailbison: a sender's totals are its lifetime counts without dates", async () => {
  const { outbound, requests, settle } = harness(suite);
  const { rows } = await settle(outbound.sender(SENDER).stats());

  assert.deepEqual(countsOf(rows[0]), {
    bounced: 3,
    clicked: null,
    contacted: 90,
    delivered: null,
    opened: 29,
    openedTotal: 41,
    positive: 4,
    replied: 11,
    sent: 120,
    unsubscribed: 2,
  });
  assert.equal(rows[0]?.evidence, "exact");
  assert.equal(urlOf(requests[0]).pathname, "/api/sender-emails/1");
});

test("emailbison: a sender's dated totals add up its daily events, marked derived", async () => {
  const { outbound, requests, settle } = harness(suite);

  const { rows } = await settle(
    outbound.sender(SENDER).stats({ from: "2025-11-25", to: "2025-11-26" })
  );

  assert.equal(rows.length, 1);
  assert.equal(rows[0]?.evidence, "derived");
  assert.equal(rows[0]?.sent, 20 + 21, "the two days' sends");
  assert.equal(rows[0]?.replied, 1 + 2);
  const url = urlOf(requests[0]);
  assert.equal(url.pathname, "/api/campaign-events/stats");
  assert.equal(url.searchParams.get("sender_email_ids[]"), "1");
});

test("emailbison: a sender's daily rows read its campaign events", async () => {
  const { outbound, settle } = harness(suite);

  const { rows } = await settle(
    outbound
      .sender(SENDER)
      .stats({ by: "day", from: "2025-11-25", to: "2025-11-26" })
  );

  assert.deepEqual(
    rows.map((row) => [row.date, row.sent, row.scope]),
    [
      ["2025-11-25", 20, "sender"],
      ["2025-11-26", 21, "sender"],
    ]
  );
});

test("emailbison: step rows place each step id by the sequence, one row per variant", async () => {
  const { outbound, requests, settle } = harness(suite);

  const { rows } = await settle(
    outbound.campaign(CAMPAIGN).stats({ scope: "step" })
  );

  assert.deepEqual(
    rows.map((row) => [
      row.stepIndex,
      row.variantKey,
      row.sent,
      row.contacted,
      row.opened,
      row.replied,
      row.bounced,
      row.unsubscribed,
      row.positive,
    ]),
    [
      [0, "A", 40, 40, 7, 3, 2, 1, 2],
      [1, "A", 18, 18, 1, 1, 0, 0, 1],
      [1, "B", 12, 12, 1, 1, 0, 0, 0],
    ]
  );
  assert.deepEqual(
    requests.map((request) => urlOf(request).pathname),
    ["/api/campaigns/1/stats", "/api/campaigns/v1.1/1/sequence-steps"]
  );
});

test("emailbison: step rows by day and a row per campaign are refused", async () => {
  const { outbound, settle } = harness(suite);

  await assert.rejects(
    async () =>
      await settle(
        outbound.campaign(CAMPAIGN).stats({ by: "day", scope: "step" })
      ),
    (error) => OutboundError.is(error) && error.code === "Unsupported"
  );

  await assert.rejects(
    async () => await settle(outbound.stats({ scope: "campaign" })),
    (error) => OutboundError.is(error) && error.code === "Unsupported"
  );
});

test("emailbison: a series it does not know, and a point that is not a day, are skipped", async () => {
  const { outbound, settle } = harness(suite, () =>
    json({
      data: [
        { dates: [["2025-11-24", 9]], label: "Something New" },
        { dates: "not a list", label: "Replied" },
        {
          dates: [["2025-11-24", 4], ["yesterday", 5], "2025-11-25"],
          label: "Sent",
        },
      ],
    })
  );

  const { rows } = await settle(
    outbound.stats({ by: "day", from: "2025-11-24", to: "2025-11-25" })
  );

  assert.deepEqual(
    rows.map((row) => [row.date, row.sent, row.replied]),
    [["2025-11-24", 4, null]]
  );
});

test("emailbison: a step id the sequence does not name has no place, so its row is left out", async () => {
  const { outbound, settle } = harness(suite, (request) =>
    request.url.endsWith("/stats")
      ? json({
          data: {
            sequence_step_stats: [
              { sent: 5, sequence_step_id: 999 },
              { sent: 6, sequence_step_id: 760 },
            ],
          },
        })
      : undefined
  );

  const { rows } = await settle(
    outbound.campaign(CAMPAIGN).stats({ scope: "step" })
  );

  assert.deepEqual(
    rows.map((row) => [row.stepIndex, row.sent]),
    [[0, 6]]
  );
});
